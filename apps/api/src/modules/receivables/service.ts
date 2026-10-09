import {
  type CreatePayment,
  type CreateReceivable,
  type EventSnapshot,
  type JsonValue,
  newId,
  type PageQuery,
  type PaymentAction,
  paymentSchema,
  type ReceivableEvent,
  type ReceivableListQuery,
  receivableEventSchema,
  receivableSchema,
  type UpdatePayment,
  type UpdateReceivable,
} from "@ledgerline/shared";
import type { Database, DatabaseConnection } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { lockTransactionCategories } from "../categories/service";
import { contactForAssignment, lockContacts } from "../contacts/service";
import { requireLedgerRead } from "../ledgers/service";
import { mergePaymentCategory } from "../transactions/category-merge-service";
import { paymentIncome, readPaymentIncome } from "../transactions/service";
import {
  runFinancialWrite,
  type WriteContext,
  type WriteIdentity,
  type WriteResponse,
} from "../writes/service";
import { nextVersion } from "../writes/version";
import { checkOwedLimits, safeOwed } from "./balance-service";
import {
  eventRepository,
  type PaymentRow,
  paymentRepository,
  type ReceivableRow,
  receivableRepository,
} from "./repo";

function required<T>(row: T | undefined): T {
  if (!row)
    throw new ApiProblem(404, "Not found", "Service or payment not found.");
  return row;
}
const money = (amount: number) => ({ amount, currency: "USD" as const });
export async function dto(
  db: DatabaseConnection,
  ledgerId: string,
  row: ReceivableRow,
) {
  const received = safeOwed(
      await receivableRepository(db, ledgerId).received(row.id),
    ),
    remaining = row.amount - received;
  return receivableSchema.parse({
    ...row,
    amount: money(row.amount),
    received: money(received),
    remaining: money(remaining),
    outstanding: money(row.deletedAt || row.writtenOffAt ? 0 : remaining),
    status: row.writtenOffAt
      ? "writtenOff"
      : received === 0
        ? "unpaid"
        : remaining === 0
          ? "paid"
          : "partlyPaid",
    writtenOffAmount:
      row.writtenOffAmount === null ? null : money(row.writtenOffAmount),
    writtenOffAt: row.writtenOffAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
async function snapshot(
  c: WriteContext,
  row: ReceivableRow,
  payment: EventSnapshot["payment"] = null,
): Promise<EventSnapshot> {
  return {
    service: {
      ...(await dto(c.tx, c.ledgerId, row)),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    },
    payment,
  };
}
async function event(
  c: WriteContext,
  row: ReceivableRow,
  action: ReceivableEvent["action"],
  before: EventSnapshot | null,
  payment: PaymentRow | null = null,
  income: EventSnapshot["payment"] = null,
) {
  await eventRepository(c.tx, c.ledgerId).add({
    contactId: row.contactId,
    receivableId: row.id,
    paymentId: payment?.id ?? null,
    transactionId: payment?.transactionId ?? null,
    actorId: c.actorId,
    receivableVersion: row.version,
    action,
    before,
    after: await snapshot(c, row, income),
  });
}
export function write(
  db: Database,
  i: WriteIdentity,
  operation: string,
  body: unknown,
  mutate: (c: WriteContext) => Promise<WriteResponse>,
) {
  return runFinancialWrite(
    db,
    { ...i, operation, request: JSON.parse(JSON.stringify(body)) as JsonValue },
    async (c) => {
      await lockTransactionCategories(c.tx, c.ledgerId);
      const r = await mutate(c);
      await checkOwedLimits(c.tx, c.ledgerId);
      return r;
    },
  );
}
export async function parent(
  c: WriteContext,
  id: string,
  deleted = false,
  newContact?: string,
) {
  const repo = receivableRepository(c.tx, c.ledgerId),
    initial = required(await repo.find(id, false, deleted));
  await lockContacts(c.tx, c.ledgerId, [
    initial.contactId,
    ...(newContact ? [newContact] : []),
  ]);
  const row = required(await repo.find(id, true, deleted));
  if (row.contactId !== initial.contactId)
    throw new ApiProblem(409, "Conflict", "Reload the latest service.");
  return row;
}
function open(row: ReceivableRow) {
  if (row.deletedAt)
    throw new ApiProblem(404, "Not found", "Service not found.");
  if (row.writtenOffAt)
    throw new ApiProblem(
      409,
      "Conflict",
      "Reopen this service before changing it or its payments.",
    );
}
export async function listReceivables(
  db: Database,
  actorId: string,
  ledgerId: string,
  q: ReceivableListQuery,
) {
  return db.transaction(
    async (tx) => {
      await requireLedgerRead(tx, actorId, ledgerId);
      if (q.contactId) await contactForAssignment(tx, ledgerId, q.contactId);
      const rows = await receivableRepository(tx, ledgerId).list(q);
      const items = [];
      for (const row of rows.slice(0, q.limit))
        items.push(await dto(tx, ledgerId, row));
      return {
        items,
        nextCursor:
          rows.length > q.limit ? (rows[q.limit - 1]?.id ?? null) : null,
      };
    },
    { isolationLevel: "repeatable read" },
  );
}
export async function getReceivable(
  db: Database,
  actorId: string,
  ledgerId: string,
  id: string,
) {
  return db.transaction(
    async (tx) => {
      await requireLedgerRead(tx, actorId, ledgerId);
      return dto(
        tx,
        ledgerId,
        required(await receivableRepository(tx, ledgerId).find(id)),
      );
    },
    { isolationLevel: "repeatable read" },
  );
}
export function saveReceivable(
  db: Database,
  i: WriteIdentity,
  id: string | null,
  body: CreateReceivable | UpdateReceivable,
) {
  return write(
    db,
    i,
    `${id ? "PATCH" : "POST"} receivables${id ? `/${id.toLowerCase()}` : ""}`,
    body,
    async (c) => {
      const repo = receivableRepository(c.tx, c.ledgerId);
      if (!id) {
        const person = required(
          (await lockContacts(c.tx, c.ledgerId, [body.contactId]))[0],
        );
        if (person.archivedAt)
          throw new ApiProblem(409, "Conflict", "Choose an active person.");
        const row = required(await repo.create(body));
        await event(c, row, "created", null);
        return { status: 201, body: await dto(c.tx, c.ledgerId, row) };
      }
      const current = await parent(c, id, false, body.contactId);
      open(current);
      const expected = (body as UpdateReceivable).expectedVersion,
        version = nextVersion(current.version, expected);
      if (body.contactId.toLowerCase() !== current.contactId) {
        if (await paymentRepository(c.tx, c.ledgerId, id).hasAny())
          throw new ApiProblem(
            409,
            "Conflict",
            "A service with payment history must keep its person.",
          );
        if (
          (await contactForAssignment(c.tx, c.ledgerId, body.contactId))
            .archivedAt
        )
          throw new ApiProblem(409, "Conflict", "Choose an active person.");
      }
      if (BigInt(body.amount.amount) < BigInt(await repo.received(id)))
        throw new ApiProblem(
          409,
          "Conflict",
          "Service amount cannot be less than received payments.",
        );
      const before = await snapshot(c, current);
      const row = required(
        await repo.update(id, expected, {
          contactId: body.contactId,
          description: body.description,
          serviceDate: body.serviceDate,
          ...(body.serviceTime !== undefined
            ? { serviceTime: body.serviceTime }
            : {}),
          dueDate: body.dueDate,
          amount: body.amount.amount,
          version,
        }),
      );
      await event(c, row, "edited", before);
      return { status: 200, body: await dto(c.tx, c.ledgerId, row) };
    },
  );
}
export function receivableAction(
  db: Database,
  i: WriteIdentity,
  id: string,
  body: { expectedVersion: number; reason?: string | null },
  action: "delete" | "restore" | "write-off" | "reopen",
) {
  return write(
    db,
    i,
    `${action === "delete" ? "DELETE" : "POST"} receivables/${id.toLowerCase()}${action === "delete" ? "" : `/${action}`}`,
    body,
    async (c) => {
      const repo = receivableRepository(c.tx, c.ledgerId),
        current = await parent(c, id, action === "restore");
      const version = nextVersion(current.version, body.expectedVersion),
        before = await snapshot(c, current);
      let changes: Partial<ReceivableRow> = { version };
      if (action === "delete") {
        if (await paymentRepository(c.tx, c.ledgerId, id).hasLive())
          throw new ApiProblem(
            409,
            "Conflict",
            "Delete the connected payments first.",
          );
        changes.deletedAt = new Date();
      }
      if (action === "restore") {
        if (!current.deletedAt)
          throw new ApiProblem(409, "Conflict", "Service is already active.");
        changes.deletedAt = null;
      }
      if (action === "write-off") {
        open(current);
        const remaining = current.amount - safeOwed(await repo.received(id));
        if (remaining === 0)
          throw new ApiProblem(
            409,
            "Conflict",
            "A paid service has no remainder to write off.",
          );
        changes = {
          ...changes,
          writtenOffAt: new Date(),
          writtenOffAmount: remaining,
          writeOffReason: body.reason ?? null,
        };
      }
      if (action === "reopen") {
        if (!current.writtenOffAt)
          throw new ApiProblem(409, "Conflict", "Service is already open.");
        changes = {
          ...changes,
          writtenOffAt: null,
          writtenOffAmount: null,
          writeOffReason: null,
        };
      }
      const row = required(await repo.update(id, current.version, changes));
      await event(
        c,
        row,
        action === "delete"
          ? "deleted"
          : action === "restore"
            ? "restored"
            : action === "reopen"
              ? "reopened"
              : "writtenOff",
        before,
      );
      return action === "delete"
        ? { status: 204, body: null }
        : { status: 200, body: await dto(c.tx, c.ledgerId, row) };
    },
  );
}
export async function paymentDto(
  db: DatabaseConnection,
  ledgerId: string,
  row: PaymentRow,
  service: ReceivableRow,
) {
  return paymentSchema.parse({
    ...row,
    amount: money(row.amount),
    transaction: await readPaymentIncome(db, ledgerId, row.transactionId),
    receivable: await dto(db, ledgerId, service),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
export async function listPayments(
  db: Database,
  actorId: string,
  ledgerId: string,
  id: string,
  q: PageQuery,
) {
  return db.transaction(
    async (tx) => {
      await requireLedgerRead(tx, actorId, ledgerId);
      const service = required(
          await receivableRepository(tx, ledgerId).find(id),
        ),
        rows = await paymentRepository(tx, ledgerId, id).list(q);
      const items = [];
      for (const row of rows.slice(0, q.limit))
        items.push(await paymentDto(tx, ledgerId, row, service));
      return {
        items,
        nextCursor:
          rows.length > q.limit ? (rows[q.limit - 1]?.id ?? null) : null,
      };
    },
    { isolationLevel: "repeatable read" },
  );
}
export async function getPayment(
  db: Database,
  actorId: string,
  ledgerId: string,
  id: string,
  paymentId: string,
) {
  return db.transaction(
    async (tx) => {
      await requireLedgerRead(tx, actorId, ledgerId);
      return paymentDto(
        tx,
        ledgerId,
        required(await paymentRepository(tx, ledgerId, id).find(paymentId)),
        required(await receivableRepository(tx, ledgerId).find(id)),
      );
    },
    { isolationLevel: "repeatable read" },
  );
}
/** One payment change inside an open financial write; shared with person-level receipts. */
export async function paymentStep(
  c: WriteContext,
  id: string,
  paymentId: string | null,
  body: CreatePayment | UpdatePayment | PaymentAction,
  action: "create" | "edit" | "delete" | "restore",
  options: { receiptId?: string; viaReceipt?: boolean } = {},
) {
  const service = await parent(c, id);
  open(service);
  const version = nextVersion(service.version, body.expectedReceivableVersion),
    repo = paymentRepository(c.tx, c.ledgerId, id),
    current = paymentId
      ? required(await repo.find(paymentId, true, action === "restore"))
      : null;
  const pv = current
    ? nextVersion(current.version, (body as PaymentAction).expectedVersion)
    : 1;
  if (current?.receiptId && !options.viaReceipt)
    throw new ApiProblem(
      409,
      "Conflict",
      "This payment belongs to a multi-service receipt. Change it from the receipt.",
    );
  if (action === "restore" && !current?.deletedAt)
    throw new ApiProblem(409, "Conflict", "Payment is already active.");
  const original = current
    ? await readPaymentIncome(c.tx, c.ledgerId, current.transactionId)
    : null;
  const before = await snapshot(c, service, original),
    input = body as CreatePayment,
    amount =
      action === "create" || action === "edit"
        ? input.amount.amount
        : required(current ?? undefined).amount,
    received = BigInt(
      await receivableRepository(c.tx, c.ledgerId).received(id),
    );
  const nextReceived =
    received -
    (current && !current.deletedAt ? BigInt(current.amount) : 0n) +
    (action === "delete" ? 0n : BigInt(amount));
  if (nextReceived > BigInt(service.amount))
    throw new ApiProblem(
      409,
      "Conflict",
      "Payment exceeds the outstanding amount.",
      [
        {
          field: "amount",
          message: "Use an amount no greater than the current remainder.",
        },
      ],
    );
  const person = await contactForAssignment(
      c.tx,
      c.ledgerId,
      service.contactId,
    ),
    pid = current?.id ?? newId(),
    tid = current?.transactionId ?? newId(),
    deletedAt = action === "delete" ? new Date() : null;
  const income = await paymentIncome(c, action, {
    id: tid,
    paymentId: pid,
    receivableId: id,
    expectedVersion: current?.version ?? 1,
    ...(deletedAt ? { deletedAt } : {}),
    ...(action === "create" || action === "edit"
      ? {
          body: {
            accountId: input.accountId,
            categoryId: input.categoryId,
            kind: "income",
            date: input.date,
            time: input.time,
            amount: money(amount),
            status: "cleared",
            payee: original?.payee ?? person.name,
            note: input.note,
          },
        }
      : {}),
  });
  const payment = required(
    current
      ? await repo.update(pid, current.version, {
          amount,
          version: pv,
          deletedAt,
        })
      : await repo.create({
          id: pid,
          ledgerId: c.ledgerId,
          receivableId: id,
          transactionId: tid,
          amount,
          ...(options.receiptId ? { receiptId: options.receiptId } : {}),
        }),
  );
  const updated = required(
    await receivableRepository(c.tx, c.ledgerId).update(id, service.version, {
      version,
    }),
  );
  await event(
    c,
    updated,
    action === "create"
      ? "paymentCreated"
      : action === "edit"
        ? "paymentEdited"
        : action === "delete"
          ? "paymentDeleted"
          : "paymentRestored",
    before,
    payment,
    income,
  );
  return action === "delete"
    ? { status: 204, body: null }
    : {
        status: action === "create" ? 201 : 200,
        body: await paymentDto(c.tx, c.ledgerId, payment, updated),
      };
}
export function mutatePayment(
  db: Database,
  i: WriteIdentity,
  id: string,
  paymentId: string | null,
  body: CreatePayment | UpdatePayment | PaymentAction,
  action: "create" | "edit" | "delete" | "restore",
) {
  return write(
    db,
    i,
    `${action === "edit" ? "PATCH" : action === "delete" ? "DELETE" : "POST"} receivables/${id.toLowerCase()}/payments${paymentId ? `/${paymentId.toLowerCase()}` : ""}${action === "restore" ? "/restore" : ""}`,
    body,
    (c) => paymentStep(c, id, paymentId, body, action),
  );
}
export async function contactHistory(
  db: Database,
  actorId: string,
  ledgerId: string,
  id: string,
  q: PageQuery,
) {
  return db.transaction(
    async (tx) => {
      await requireLedgerRead(tx, actorId, ledgerId);
      await contactForAssignment(tx, ledgerId, id);
      const rows = await eventRepository(tx, ledgerId).list(id, q);
      return {
        items: rows.slice(0, q.limit).map((r) =>
          receivableEventSchema.parse({
            ...r,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
          }),
        ),
        nextCursor:
          rows.length > q.limit ? (rows[q.limit - 1]?.id ?? null) : null,
      };
    },
    { isolationLevel: "repeatable read" },
  );
}

/** Category-only maintenance facts, discovered under the caller's category lock. */
export async function categoryMergePayments(
  db: DatabaseConnection,
  ledgerId: string,
  links: readonly {
    id: string;
    receivableId: string | null;
    receivablePaymentId: string | null;
    version: number;
  }[],
) {
  const services = new Map<string, ReceivableRow>();
  const payments: PaymentRow[] = [];
  for (const link of links) {
    if (!link.receivableId || !link.receivablePaymentId)
      throw new ApiProblem(
        409,
        "Conflict",
        "Reload the category merge preview.",
      );
    const service =
      services.get(link.receivableId) ??
      required(
        await receivableRepository(db, ledgerId).find(link.receivableId),
      );
    services.set(service.id, service);
    const payment = required(
      await paymentRepository(db, ledgerId, service.id).find(
        link.receivablePaymentId,
      ),
    );
    if (payment.transactionId !== link.id || payment.version !== link.version)
      throw new ApiProblem(
        409,
        "Conflict",
        "Reload the category merge preview.",
      );
    payments.push(payment);
  }
  return {
    services: [...services.values()].sort((a, b) => a.id.localeCompare(b.id)),
    payments: payments.sort(
      (a, b) =>
        a.receivableId.localeCompare(b.receivableId) ||
        a.id.localeCompare(b.id),
    ),
  };
}
export type CategoryMergePayments = Awaited<
  ReturnType<typeof categoryMergePayments>
>;

/** No public payment-edit bypass: this hook can change only the category of a live pair. */
export async function mergeLinkedPaymentCategories(
  c: WriteContext,
  sourceId: string,
  destinationId: string,
  facts: CategoryMergePayments,
) {
  await lockContacts(
    c.tx,
    c.ledgerId,
    facts.services.map((row) => row.contactId),
  );
  for (const initial of facts.services) {
    let service = required(
      await receivableRepository(c.tx, c.ledgerId).find(initial.id, true),
    );
    if (
      service.version !== initial.version ||
      service.contactId !== initial.contactId
    )
      throw new ApiProblem(
        409,
        "Conflict",
        "Reload the category merge preview.",
      );
    for (const original of facts.payments.filter(
      (row) => row.receivableId === service.id,
    )) {
      const repo = paymentRepository(c.tx, c.ledgerId, service.id);
      const payment = required(await repo.find(original.id, true));
      const paymentVersion = nextVersion(payment.version, original.version);
      const serviceVersion = nextVersion(service.version, service.version);
      const before = await snapshot(
        c,
        service,
        await readPaymentIncome(c.tx, c.ledgerId, payment.transactionId),
      );
      await mergePaymentCategory(c, {
        transactionId: payment.transactionId,
        paymentId: payment.id,
        receivableId: service.id,
        expectedVersion: payment.version,
        sourceId,
        destinationId,
      });
      const updatedPayment = required(
        await repo.update(payment.id, payment.version, {
          version: paymentVersion,
        }),
      );
      service = required(
        await receivableRepository(c.tx, c.ledgerId).update(
          service.id,
          service.version,
          { version: serviceVersion },
        ),
      );
      await event(
        c,
        service,
        "paymentEdited",
        before,
        updatedPayment,
        await readPaymentIncome(c.tx, c.ledgerId, payment.transactionId),
      );
    }
  }
}
