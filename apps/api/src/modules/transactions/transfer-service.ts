import {
  type CreateTransfer,
  type JsonValue,
  transferSchema,
  type UpdateTransfer,
} from "@ledgerline/shared";
import type { Database } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { lockTransactionAccounts } from "../accounts/service";
import { requireLedgerRead } from "../ledgers/service";
import {
  runFinancialWrite,
  type WriteContext,
  type WriteIdentity,
  type WriteResponse,
} from "../writes/service";
import { nextVersion } from "../writes/version";
import { postedBalance, postedTransactionTotals } from "./balance-service";
import type { TransactionRow } from "./repo";
import { transferRepository } from "./transfer-repo";

function pair(rows: TransactionRow[]) {
  const from = rows.find((row) => row.amount < 0),
    to = rows.find((row) => row.amount > 0);
  if (rows.length !== 2 || !from || !to)
    throw new ApiProblem(404, "Not found", "Transfer not found.");
  return { from, to };
}
function dto(rows: TransactionRow[]) {
  const { from, to } = pair(rows);
  return transferSchema.parse({
    id: from.transferId,
    ledgerId: from.ledgerId,
    fromAccountId: from.accountId,
    toAccountId: to.accountId,
    fromTransactionId: from.id,
    toTransactionId: to.id,
    amount: { amount: to.amount, currency: to.currency },
    date: from.date,
    time: from.time,
    note: from.note,
    version: from.version,
    createdAt: from.createdAt.toISOString(),
    updatedAt: from.updatedAt.toISOString(),
  });
}
async function references(
  context: WriteContext,
  body: CreateTransfer,
  current?: ReturnType<typeof pair>,
) {
  const rows = await lockTransactionAccounts(context.tx, context.ledgerId, [
    body.fromAccountId,
    body.toAccountId,
    ...(current ? [current.from.accountId, current.to.accountId] : []),
  ]);
  for (const [field, old] of [
    ["fromAccountId", current?.from.accountId],
    ["toAccountId", current?.to.accountId],
  ] as const) {
    const account = rows.find((row) => row.id === body[field].toLowerCase());
    if (account?.archivedAt && account.id !== old)
      throw new ApiProblem(409, "Conflict", "Choose an active account.", [
        { field, message: "Choose an active account." },
      ]);
  }
  return rows;
}
async function check(
  context: WriteContext,
  rows: Awaited<ReturnType<typeof references>>,
) {
  const totals = await postedTransactionTotals(
    context.tx,
    context.ledgerId,
    rows.map((row) => row.id),
  );
  for (const row of rows) postedBalance(row.openingBalance, totals.get(row.id));
}
function write(
  db: Database,
  identity: WriteIdentity,
  operation: string,
  request: JsonValue,
  mutate: (context: WriteContext) => Promise<WriteResponse>,
) {
  return runFinancialWrite(db, { ...identity, operation, request }, mutate);
}
export async function getTransfer(
  db: Database,
  actorId: string,
  ledgerId: string,
  id: string,
) {
  await requireLedgerRead(db, actorId, ledgerId);
  return dto(await transferRepository(db, ledgerId).find(id));
}
export function createTransfer(
  db: Database,
  identity: WriteIdentity,
  body: CreateTransfer,
) {
  return write(db, identity, "POST transfers", body, async (context) => {
    const rows = await references(context, body);
    const saved = await transferRepository(context.tx, context.ledgerId).create(
      body,
    );
    await check(context, rows);
    return { status: 201, body: dto(saved) };
  });
}
export function updateTransfer(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: UpdateTransfer,
) {
  return write(
    db,
    identity,
    `PATCH transfers/${id.toLowerCase()}`,
    body,
    async (context) => {
      const repo = transferRepository(context.tx, context.ledgerId);
      const current = pair(await repo.find(id, true));
      const version = nextVersion(current.from.version, body.expectedVersion);
      const rows = await references(context, body, current);
      const saved = await repo.update(id, body, version);
      await check(context, rows);
      return { status: 200, body: dto(saved) };
    },
  );
}
export function transferLifecycle(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: { expectedVersion: number },
  restore: boolean,
) {
  return write(
    db,
    identity,
    `${restore ? "POST" : "DELETE"} transfers/${id.toLowerCase()}${restore ? "/restore" : ""}`,
    body,
    async (context) => {
      const repo = transferRepository(context.tx, context.ledgerId);
      const saved = await repo.find(id, true, restore),
        current = pair(saved);
      const version = nextVersion(current.from.version, body.expectedVersion);
      if (restore && !current.from.deletedAt)
        throw new ApiProblem(
          409,
          "Conflict",
          "This transfer is already active.",
        );
      const rows = await references(context, dto(saved), current);
      const updated = await repo.lifecycle(
        id,
        restore ? null : new Date(),
        version,
      );
      await check(context, rows);
      return restore
        ? { status: 200, body: dto(updated) }
        : { status: 204, body: null };
    },
  );
}
