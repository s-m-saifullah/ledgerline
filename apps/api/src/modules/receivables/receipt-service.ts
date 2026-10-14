import {
  allocateBaseAmounts,
  allocateSerially,
  type CreateReceipt,
  MAX_RECEIPT_ALLOCATIONS,
  type Money,
  newId,
  type ReceiptAction,
  receiptPreviewSchema,
  receiptSchema,
  type UpdateReceipt,
} from "@ledgerline/shared";
import type { Database, DatabaseConnection } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { contactForAssignment, lockContacts } from "../contacts/service";
import { requireLedgerRead } from "../ledgers/service";
import type { WriteIdentity } from "../writes/service";
import { safeOwed } from "./balance-service";
import { receiptPaymentRepository, receivableRepository } from "./repo";
import { paymentDto, paymentStep, write } from "./service";

const money = (amount: number, currency: string) => ({ amount, currency });
/**
 * Share what arrived in the account across a receipt's payments in proportion to what each
 * settles, so the shares add up exactly. Every payment must receive something.
 */
function shareReceived(
  settled: readonly number[],
  received: Money | undefined,
  field: string,
) {
  if (!received) return settled.map(() => undefined);
  const total = settled.reduce((sum, amount) => sum + amount, 0);
  const shares = allocateBaseAmounts(total, received.amount, [...settled]);
  if (shares.some((share) => share <= 0))
    throw new ApiProblem(
      409,
      "Conflict",
      "The amount received is too small to share across these services.",
      [{ field, message: "Use a larger amount received." }],
    );
  return shares.map((share) => ({
    amount: share,
    currency: received.currency,
  }));
}
const notFound = () => new ApiProblem(404, "Not found", "Receipt not found.");

/** Open services oldest-first with exact outstanding cents, and the serial allocation. */
async function plan(
  db: DatabaseConnection,
  ledgerId: string,
  contactId: string,
  amount: number,
  currency: string,
) {
  const repo = receivableRepository(db, ledgerId);
  const services = [];
  for (const row of await repo.openForContact(contactId, currency))
    services.push({
      row,
      outstanding: row.amount - safeOwed(await repo.received(row.id)),
    });
  const openTotal = services.reduce(
    (sum, s) => sum + BigInt(s.outstanding),
    0n,
  );
  const exceeds = BigInt(amount) > openTotal;
  const { allocations } = exceeds
    ? { allocations: [] }
    : allocateSerially(
        amount,
        services.map((s) => ({ id: s.row.id, outstanding: s.outstanding })),
      );
  const byId = new Map(services.map((s) => [s.row.id, s]));
  return {
    openTotal,
    exceeds,
    tooMany: allocations.length > MAX_RECEIPT_ALLOCATIONS,
    allocations: allocations.map((a) => {
      const s = byId.get(a.id);
      if (!s) throw new Error("Allocation without service");
      return {
        receivableId: s.row.id,
        description: s.row.description,
        serviceDate: s.row.serviceDate,
        version: s.row.version,
        outstanding: money(s.outstanding, currency),
        applied: money(a.applied, currency),
        remainingAfter: money(a.remainingAfter, currency),
      };
    }),
  };
}

export async function previewReceipt(
  db: Database,
  actorId: string,
  ledgerId: string,
  contactId: string,
  amount: number,
  currency: string,
) {
  return db.transaction(
    async (tx) => {
      await requireLedgerRead(tx, actorId, ledgerId);
      await contactForAssignment(tx, ledgerId, contactId);
      const p = await plan(tx, ledgerId, contactId, amount, currency);
      return receiptPreviewSchema.parse({
        contactId,
        amount: money(amount, currency),
        openTotal: money(safeOwed(p.openTotal), currency),
        exceedsBalance: p.exceeds,
        tooManyServices: p.tooMany,
        allocations: p.allocations,
      });
    },
    { isolationLevel: "repeatable read" },
  );
}

async function readReceipt(
  db: DatabaseConnection,
  ledgerId: string,
  receiptId: string,
  deleted = false,
) {
  const rows = await receiptPaymentRepository(db, ledgerId, receiptId).list(
    deleted,
  );
  if (!rows.length) throw notFound();
  const payments = [];
  let contactId = "";
  for (const row of rows) {
    const service = await receivableRepository(db, ledgerId).find(
      row.receivableId,
      false,
      true,
    );
    if (!service) throw notFound();
    contactId = service.contactId;
    payments.push(await paymentDto(db, ledgerId, row, service));
  }
  return receiptSchema.parse({
    id: receiptId,
    contactId,
    amount: money(
      safeOwed(rows.reduce((sum, r) => sum + BigInt(r.amount), 0n)),
      rows[0]?.currency ?? "USD",
    ),
    payments,
  });
}
export async function getReceipt(
  db: Database,
  actorId: string,
  ledgerId: string,
  receiptId: string,
) {
  return db.transaction(
    async (tx) => {
      await requireLedgerRead(tx, actorId, ledgerId);
      return readReceipt(tx, ledgerId, receiptId);
    },
    { isolationLevel: "repeatable read" },
  );
}

export function createReceipt(
  db: Database,
  i: WriteIdentity,
  contactId: string,
  body: CreateReceipt,
) {
  return write(
    db,
    i,
    `POST contacts/${contactId.toLowerCase()}/receipts`,
    body,
    async (c) => {
      await lockContacts(c.tx, c.ledgerId, [contactId]);
      await contactForAssignment(c.tx, c.ledgerId, contactId);
      const p = await plan(
        c.tx,
        c.ledgerId,
        contactId,
        body.amount.amount,
        body.amount.currency,
      );
      if (p.exceeds)
        throw new ApiProblem(
          409,
          "Conflict",
          "Payment exceeds the client's open balance.",
          [
            {
              field: "amount",
              message: "Use an amount no greater than the open balance.",
            },
          ],
        );
      if (p.tooMany)
        throw new ApiProblem(
          409,
          "Conflict",
          `A receipt can cover at most ${MAX_RECEIPT_ALLOCATIONS} services. Record a smaller payment first.`,
        );
      const same =
        body.expectedAllocations.length === p.allocations.length &&
        p.allocations.every((a, index) => {
          const e = body.expectedAllocations[index];
          return (
            e &&
            e.receivableId.toLowerCase() === a.receivableId &&
            e.expectedVersion === a.version &&
            e.applied === a.applied.amount
          );
        });
      if (!same)
        throw new ApiProblem(
          409,
          "Conflict",
          "Balances changed. Review the updated allocation and try again.",
        );
      const receiptId = newId();
      const received = shareReceived(
        p.allocations.map((a) => a.applied.amount),
        body.receivedAmount,
        "receivedAmount",
      );
      for (const [index, a] of p.allocations.entries())
        await paymentStep(
          c,
          a.receivableId,
          null,
          {
            amount: a.applied,
            receivedAmount: received[index],
            fxRate: body.fxRate,
            accountId: body.accountId,
            categoryId: body.categoryId,
            date: body.date,
            time: body.time,
            note: body.note,
            expectedReceivableVersion: a.version,
          },
          "create",
          { receiptId, ...(index === 0 && body.tip ? { tip: body.tip } : {}) },
        );
      return {
        status: 201,
        body: await readReceipt(c.tx, c.ledgerId, receiptId),
      };
    },
  );
}

type Change = UpdateReceipt | ReceiptAction;
export function changeReceipt(
  db: Database,
  i: WriteIdentity,
  receiptId: string,
  body: Change,
  action: "edit" | "delete" | "restore",
) {
  return write(
    db,
    i,
    `${action === "edit" ? "PATCH" : action === "delete" ? "DELETE" : "POST"} receipts/${receiptId.toLowerCase()}${action === "restore" ? "/restore" : ""}`,
    body,
    async (c) => {
      const deleted = action === "restore";
      const first = (
        await receiptPaymentRepository(c.tx, c.ledgerId, receiptId).list(
          deleted,
        )
      )[0];
      if (!first) throw notFound();
      const service = await receivableRepository(c.tx, c.ledgerId).find(
        first.receivableId,
        false,
        true,
      );
      if (!service) throw notFound();
      await lockContacts(c.tx, c.ledgerId, [service.contactId]);
      const rows = await receiptPaymentRepository(
        c.tx,
        c.ledgerId,
        receiptId,
      ).list(deleted);
      const expected = new Map(
        body.expectedPayments.map((e) => [e.paymentId.toLowerCase(), e]),
      );
      if (
        expected.size !== rows.length ||
        rows.some((row) => !expected.has(row.id))
      )
        throw new ApiProblem(
          409,
          "Conflict",
          "This receipt changed. Reload the latest details.",
        );
      const fields = body as UpdateReceipt;
      const received = shareReceived(
        rows.map((row) => row.amount),
        action === "edit" ? fields.receivedAmount : undefined,
        "receivedAmount",
      );
      for (const [index, row] of rows.entries()) {
        const e = expected.get(row.id);
        if (!e) throw new Error("Missing expectation");
        const versions = {
          expectedVersion: e.expectedVersion,
          expectedReceivableVersion: e.expectedReceivableVersion,
        };
        await paymentStep(
          c,
          row.receivableId,
          row.id,
          action === "edit"
            ? {
                amount: money(row.amount, row.currency),
                receivedAmount: received[index],
                fxRate: fields.fxRate,
                accountId: fields.accountId,
                categoryId: fields.categoryId,
                date: fields.date,
                time: fields.time,
                note: fields.note,
                ...versions,
              }
            : versions,
          action,
          { viaReceipt: true },
        );
      }
      return action === "delete"
        ? { status: 204, body: null }
        : { status: 200, body: await readReceipt(c.tx, c.ledgerId, receiptId) };
    },
  );
}
