import {
  type CreateTransaction,
  createTransactionSchema,
  type DeleteTransaction,
  type JsonValue,
  type RestoreTransaction,
  type TransactionListQuery,
  transactionSchema,
  type UpdateTransaction,
} from "@ledgerline/shared";
import type { Database, DatabaseConnection } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { lockTransactionAccounts } from "../accounts/service";
import {
  lockTransactionCategories,
  validateTransactionCategory,
} from "../categories/service";
import { requireLedgerRead } from "../ledgers/service";
import {
  runFinancialWrite,
  type WriteContext,
  type WriteIdentity,
  type WriteResponse,
} from "../writes/service";
import { nextVersion, requireVersionUpdate } from "../writes/version";
import { postedBalance, postedTransactionTotals } from "./balance-service";
import { type TransactionRow, transactionRepository } from "./repo";

import { type SplitRow, splitDto, splitRepository } from "./split-repo";

async function dto(
  db: DatabaseConnection,
  ledgerId: string,
  row: TransactionRow,
) {
  return transactionSchema.parse({
    ...row,
    splits: row.isSplit
      ? (await splitRepository(db, ledgerId).forParent(row)).map(splitDto)
      : [],
    amount: { amount: row.amount, currency: row.currency },
    baseAmount: { amount: row.baseAmount, currency: row.currency },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
function required(row: TransactionRow | undefined) {
  if (!row) throw new ApiProblem(404, "Not found", "Transaction not found.");
  return row;
}
function ordinary(row: TransactionRow) {
  if (row.receivablePaymentId)
    throw new ApiProblem(
      409,
      "Conflict",
      "Use the payment endpoint to change linked income.",
    );
  if (row.transferId)
    throw new ApiProblem(
      409,
      "Conflict",
      "Use the transfer endpoint to change a transfer.",
    );
}

/** Internal paired payment operation: the caller owns one outer write/receipt. */
export async function paymentIncome(
  context: WriteContext,
  action: "create" | "edit" | "delete" | "restore",
  input: {
    id: string;
    paymentId: string;
    receivableId: string;
    expectedVersion: number;
    body?: CreateTransaction;
    deletedAt?: Date;
  },
) {
  const repo = transactionRepository(context.tx, context.ledgerId);
  const current =
    action === "create"
      ? undefined
      : required(await repo.find(input.id, true, action === "restore"));
  if (
    current &&
    (current.receivablePaymentId !== input.paymentId.toLowerCase() ||
      current.receivableId !== input.receivableId.toLowerCase())
  )
    throw new ApiProblem(404, "Not found", "Payment income not found.");
  const version = current
    ? nextVersion(current.version, input.expectedVersion)
    : 1;
  if (action === "restore" && !current?.deletedAt)
    throw new ApiProblem(409, "Conflict", "Payment is already active.");
  const body =
    input.body ??
    (current
      ? createTransactionSchema.parse({
          accountId: current.accountId,
          categoryId: current.categoryId,
          kind: "income",
          date: current.date,
          time: current.time,
          amount: { amount: current.amount, currency: "USD" },
          status: "cleared",
          payee: current.payee,
          note: current.note,
        })
      : null);
  if (!body) throw new Error("Missing payment fields");
  const rows = await references(context, body, current);
  const row = required(
    await repo.saveLinked(input.id, current?.version, body, {
      paymentId: input.paymentId,
      receivableId: input.receivableId,
      version,
      deletedAt: action === "delete" ? (input.deletedAt ?? new Date()) : null,
    }),
  );
  await checkBalances(context, rows);
  return {
    ...(await dto(context.tx, context.ledgerId, row)),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}
export async function readPaymentIncome(
  db: DatabaseConnection,
  ledgerId: string,
  id: string,
) {
  const row = required(
    await transactionRepository(db, ledgerId).find(id, false, true),
  );
  return {
    ...(await dto(db, ledgerId, row)),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}
async function write(
  db: Database,
  identity: WriteIdentity,
  operation: string,
  request: unknown,
  mutate: (context: WriteContext) => Promise<WriteResponse>,
) {
  const result = await runFinancialWrite(
    db,
    {
      ...identity,
      operation,
      request: JSON.parse(JSON.stringify(request)) as JsonValue,
    },
    async (context) => {
      await lockTransactionCategories(context.tx, context.ledgerId);
      return mutate(context);
    },
  );
  // Normalize historical receipts before serialization; no saved request/receipt is mutated.
  return {
    ...result,
    body: result.status === 204 ? null : transactionSchema.parse(result.body),
  };
}
export async function listTransactions(
  db: Database,
  actorId: string,
  ledgerId: string,
  query: TransactionListQuery,
) {
  return db.transaction(
    async (tx) => {
      await requireLedgerRead(tx, actorId, ledgerId);
      const rows = await transactionRepository(tx, ledgerId).list(query);
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const splits = page.length
        ? await splitRepository(tx, ledgerId).list(page.map((row) => row.id))
        : [];
      return {
        items: page.map((row) =>
          transactionSchema.parse({
            ...row,
            amount: { amount: row.amount, currency: row.currency },
            baseAmount: { amount: row.baseAmount, currency: row.currency },
            splits: splits
              .filter((line) => line.transactionId === row.id)
              .map(splitDto),
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          }),
        ),
        nextCursor:
          rows.length > query.limit && last ? `${last.date}_${last.id}` : null,
      };
    },
    { isolationLevel: "repeatable read" },
  );
}
export async function getTransaction(
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
        required(await transactionRepository(tx, ledgerId).find(id)),
      );
    },
    { isolationLevel: "repeatable read" },
  );
}
async function references(
  context: WriteContext,
  body: CreateTransaction,
  current?: TransactionRow,
  previous: SplitRow[] = [],
) {
  const { tx, ledgerId } = context;
  const rows = await lockTransactionAccounts(tx, ledgerId, [
    body.accountId,
    ...(current ? [current.accountId] : []),
  ]);
  const target = rows.find((row) => row.id === body.accountId.toLowerCase());
  if (target?.archivedAt && body.accountId.toLowerCase() !== current?.accountId)
    throw new ApiProblem(409, "Conflict", "Choose an active account.", [
      { field: "accountId", message: "Choose an active account." },
    ]);
  if (body.splits) {
    for (const line of body.splits) {
      const old = previous.find((row) => row.id === line.id?.toLowerCase());
      if (line.id && !old)
        throw new ApiProblem(404, "Not found", "Split line not found.");
      await validateTransactionCategory(
        tx,
        ledgerId,
        line.categoryId,
        body.kind,
        line.categoryId.toLowerCase() !== old?.categoryId ||
          body.kind !== old?.kind,
      );
    }
  } else if (body.categoryId) {
    await validateTransactionCategory(
      tx,
      ledgerId,
      body.categoryId,
      body.kind,
      body.categoryId.toLowerCase() !== current?.categoryId ||
        body.kind !== current?.kind,
    );
  }
  return rows;
}
async function checkBalances(
  context: WriteContext,
  rows: Awaited<ReturnType<typeof lockTransactionAccounts>>,
) {
  const totals = await postedTransactionTotals(
    context.tx,
    context.ledgerId,
    rows.map((row) => row.id),
  );
  for (const row of rows) postedBalance(row.openingBalance, totals.get(row.id));
}
export function createTransaction(
  db: Database,
  identity: WriteIdentity,
  body: CreateTransaction,
) {
  const { time, ...fields } = body;
  const request = time === undefined ? fields : { ...fields, time };
  return write(db, identity, "POST transactions", request, async (context) => {
    if (body.splits?.some((line) => line.id))
      throw new ApiProblem(
        400,
        "Invalid request",
        "New split lines must not supply IDs.",
      );
    const rows = await references(context, body);
    const row = required(
      await transactionRepository(context.tx, context.ledgerId).create(body),
    );
    await splitRepository(context.tx, context.ledgerId).replace(
      row,
      body.splits ?? [],
      [],
    );
    await checkBalances(context, rows);
    return { status: 201, body: await dto(context.tx, context.ledgerId, row) };
  });
}
export function updateTransaction(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: UpdateTransaction,
) {
  const { expectedVersion, ...input } = body;
  const changes = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
  return write(
    db,
    identity,
    `PATCH transactions/${id.toLowerCase()}`,
    { expectedVersion, ...changes },
    async (context) => {
      const repo = transactionRepository(context.tx, context.ledgerId);
      const current = required(await repo.find(id, true));
      ordinary(current);
      const version = nextVersion(current.version, expectedVersion);
      const previous = await splitRepository(
        context.tx,
        context.ledgerId,
      ).forParent(current);
      const parsed = createTransactionSchema.safeParse({
        accountId: current.accountId,
        categoryId: current.categoryId,
        kind: current.kind,
        date: current.date,
        time: current.time,
        amount: { amount: current.amount, currency: current.currency },
        status: current.status,
        payee: current.payee,
        note: current.note,
        ...(current.isSplit
          ? {
              splits: previous.map((line) => ({
                id: line.id,
                categoryId: line.categoryId,
                amount: { amount: line.amount, currency: "USD" },
                note: line.note,
              })),
            }
          : {}),
        ...changes,
        ...(body.splits === null ? { splits: undefined } : {}),
      });
      if (!parsed.success)
        throw new ApiProblem(
          400,
          "Invalid request",
          "Check the transaction fields.",
          parsed.error.issues.map((issue) => ({
            field: issue.path.join(".") || "transaction",
            message: issue.message,
          })),
        );
      const rows = await references(context, parsed.data, current, previous);
      const row = requireVersionUpdate(
        await repo.update(id, expectedVersion, parsed.data, version),
      );
      await splitRepository(context.tx, context.ledgerId).replace(
        row,
        parsed.data.splits ?? [],
        previous,
      );
      await checkBalances(context, rows);
      return {
        status: 200,
        body: await dto(context.tx, context.ledgerId, row),
      };
    },
  );
}
export function deleteTransaction(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: DeleteTransaction,
) {
  return write(
    db,
    identity,
    `DELETE transactions/${id.toLowerCase()}`,
    body,
    async (context) => {
      const repo = transactionRepository(context.tx, context.ledgerId);
      const current = required(await repo.find(id, true));
      ordinary(current);
      const version = nextVersion(current.version, body.expectedVersion);
      const rows = await lockTransactionAccounts(context.tx, context.ledgerId, [
        current.accountId,
      ]);
      const previous = await splitRepository(
        context.tx,
        context.ledgerId,
      ).forParent(current);
      const row = requireVersionUpdate(
        await repo.remove(id, body.expectedVersion, version),
      );
      await splitRepository(context.tx, context.ledgerId).tombstone(
        row,
        previous,
        row.deletedAt,
      );
      await checkBalances(context, rows);
      return { status: 204, body: null };
    },
  );
}

export function restoreTransaction(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: RestoreTransaction,
) {
  return write(
    db,
    identity,
    `POST transactions/${id.toLowerCase()}/restore`,
    body,
    async (context) => {
      const repo = transactionRepository(context.tx, context.ledgerId);
      const current = required(await repo.find(id, true, true));
      ordinary(current);
      const version = nextVersion(current.version, body.expectedVersion);
      if (!current.deletedAt)
        throw new ApiProblem(
          409,
          "Conflict",
          "This transaction is already active.",
        );
      const previous = await splitRepository(
        context.tx,
        context.ledgerId,
      ).forParent(current);
      const entry = createTransactionSchema.parse({
        accountId: current.accountId,
        categoryId: current.categoryId,
        kind: current.kind,
        date: current.date,
        time: current.time,
        amount: { amount: current.amount, currency: current.currency },
        status: current.status,
        payee: current.payee,
        note: current.note,
        ...(current.isSplit
          ? {
              splits: previous.map((line) => ({
                id: line.id,
                categoryId: line.categoryId,
                amount: { amount: line.amount, currency: "USD" },
                note: line.note,
              })),
            }
          : {}),
      });
      const rows = await references(context, entry, current, previous);
      const row = requireVersionUpdate(
        await repo.restore(id, body.expectedVersion, version),
      );
      await splitRepository(context.tx, context.ledgerId).tombstone(
        row,
        previous,
        null,
      );
      await checkBalances(context, rows);
      return {
        status: 200,
        body: await dto(context.tx, context.ledgerId, row),
      };
    },
  );
}
