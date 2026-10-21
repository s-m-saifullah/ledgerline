import {
  type CreateTransfer,
  feeFromBps,
  type JsonValue,
  type Money,
  type TagRef,
  transferSchema,
  type UpdateTransfer,
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
import { nextVersion } from "../writes/version";
import { postedBalance, postedTransactionTotals } from "./balance-service";
import { priceEntry, priceTransfer } from "./pricing";
import type { TransactionRow } from "./repo";
import { assignTags, entryTags } from "./tag-service";
import { transferRepository } from "./transfer-repo";

function accountOf(
  rows: Awaited<ReturnType<typeof references>>,
  accountId: string,
) {
  const account = rows.find((row) => row.id === accountId.toLowerCase());
  if (!account) throw new ApiProblem(404, "Not found", "Account not found.");
  return account;
}
/** The request as canonical JSON: optional fields that were left out stay out. */
const requestOf = (body: object) =>
  JSON.parse(JSON.stringify(body)) as JsonValue;
function pair(rows: TransactionRow[]) {
  const from = rows.find((row) => row.amount < 0),
    to = rows.find((row) => row.amount > 0);
  if (rows.length !== 2 || !from || !to)
    throw new ApiProblem(404, "Not found", "Transfer not found.");
  return { from, to };
}
const linkedDto = (entry?: TransactionRow) =>
  entry?.categoryId
    ? {
        transactionId: entry.id,
        // A fee is stored as a negative expense; the API shows what it cost.
        amount: { amount: Math.abs(entry.amount), currency: entry.currency },
        categoryId: entry.categoryId,
        deletedAt: entry.deletedAt?.toISOString() ?? null,
      }
    : null;
function dto(
  rows: TransactionRow[],
  bonus?: TransactionRow,
  fee?: TransactionRow,
  tags: TagRef[] = [],
) {
  const { from, to } = pair(rows);
  return transferSchema.parse({
    id: from.transferId,
    ledgerId: from.ledgerId,
    fromAccountId: from.accountId,
    toAccountId: to.accountId,
    fromTransactionId: from.id,
    toTransactionId: to.id,
    amount: { amount: -from.amount, currency: from.currency },
    receivedAmount: { amount: to.amount, currency: to.currency },
    // The base currency is USD for every ledger today (ADR 0020).
    baseAmount: { amount: to.baseAmount, currency: "USD" },
    bonus: linkedDto(bonus),
    fee: linkedDto(fee),
    tags,
    date: from.date,
    time: from.time,
    note: from.note,
    version: from.version,
    createdAt: from.createdAt.toISOString(),
    updatedAt: from.updatedAt.toISOString(),
  });
}
/** The tags a transfer carries (both legs carry the same ones; the sending leg is read). */
async function tagsOf(
  db: DatabaseConnection,
  ledgerId: string,
  rows: TransactionRow[],
) {
  const { from } = pair(rows);
  return (await entryTags(db, ledgerId, [from.id])).get(from.id) ?? [];
}
/** What a requested fee costs, in the sending account's smallest unit (ADR 0025). */
function feeCost(
  fee: NonNullable<CreateTransfer["fee"]>,
  sent: Money,
  currency: string,
) {
  let cost: number;
  if ("amount" in fee) {
    if (fee.amount.currency !== currency)
      throw new ApiProblem(
        409,
        "Conflict",
        `The sending account uses ${currency}. Enter the fee in ${currency}.`,
        [
          {
            field: "fee.amount.currency",
            message: `Use ${currency}, the sending account's currency.`,
          },
        ],
      );
    cost = fee.amount.amount;
  } else cost = feeFromBps(sent.amount, fee.basisPoints);
  if (cost < 1)
    throw new ApiProblem(
      409,
      "Conflict",
      "The fee comes to less than the smallest unit.",
      [{ field: "fee", message: "Enter a larger fee or leave it out." }],
    );
  return cost;
}
async function references(
  context: WriteContext,
  body: Pick<CreateTransfer, "fromAccountId" | "toAccountId">,
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
  const repo = transferRepository(db, ledgerId);
  const rows = await repo.find(id);
  return dto(
    rows,
    await repo.bonus(id),
    await repo.fee(id),
    await tagsOf(db, ledgerId, rows),
  );
}
/** Saves a transfer (and its optional bonus and fee) inside a write that is already open. */
export async function createTransferInContext(
  context: WriteContext,
  body: CreateTransfer,
  transferId?: string,
) {
  const rows = await references(context, body);
  const pricing = await priceTransfer(context, {
    from: accountOf(rows, body.fromAccountId),
    to: accountOf(rows, body.toAccountId),
    amount: body.amount,
    receivedAmount: body.receivedAmount,
    date: body.date,
    manualRate: body.fxRate,
  });
  const repo = transferRepository(context.tx, context.ledgerId);
  const saved = await repo.create(body, pricing, transferId);
  if (body.tagIds?.length)
    await assignTags(
      context.tx,
      context.ledgerId,
      saved.map((row) => row.id),
      body.tagIds,
    );
  let bonus: TransactionRow | undefined;
  if (body.bonus) {
    const to = accountOf(rows, body.toAccountId);
    const categoryId = body.bonus.categoryId ?? to.bonusCategoryId;
    if (!categoryId)
      throw new ApiProblem(
        409,
        "Conflict",
        "Choose a category for the bonus.",
        [
          {
            field: "bonus.categoryId",
            message: "Choose an income category for the bonus.",
          },
        ],
      );
    await lockTransactionCategories(context.tx, context.ledgerId);
    await validateTransactionCategory(
      context.tx,
      context.ledgerId,
      categoryId,
      "income",
      true,
    );
    // The bonus is income in the receiving account's currency, priced like any entry.
    const bonusPricing = await priceEntry(context, {
      accountCurrency: to.currency,
      amount: body.bonus.amount,
      date: body.date,
    });
    bonus = await repo.createBonus(
      pair(saved).from.transferId as string,
      {
        accountId: to.id,
        categoryId,
        amount: body.bonus.amount.amount,
        currency: body.bonus.amount.currency,
        date: body.date,
        time: body.time,
      },
      bonusPricing,
    );
  }
  let fee: TransactionRow | undefined;
  if (body.fee) {
    const from = accountOf(rows, body.fromAccountId);
    const categoryId = body.fee.categoryId ?? from.feeCategoryId;
    if (!categoryId)
      throw new ApiProblem(409, "Conflict", "Choose a category for the fee.", [
        {
          field: "fee.categoryId",
          message: "Choose an expense category for the fee.",
        },
      ]);
    await lockTransactionCategories(context.tx, context.ledgerId);
    await validateTransactionCategory(
      context.tx,
      context.ledgerId,
      categoryId,
      "expense",
      true,
    );
    const cost = feeCost(body.fee, body.amount, from.currency);
    // The fee is an expense in the sending account's currency, priced like any entry.
    const feePricing = await priceEntry(context, {
      accountCurrency: from.currency,
      amount: { amount: -cost, currency: from.currency },
      date: body.date,
    });
    fee = await repo.createFee(
      pair(saved).from.transferId as string,
      {
        accountId: from.id,
        categoryId,
        amount: -cost,
        currency: from.currency,
        date: body.date,
        time: body.time,
      },
      feePricing,
    );
  }
  await check(context, rows);
  return {
    status: 201,
    body: dto(
      saved,
      bonus,
      fee,
      await tagsOf(context.tx, context.ledgerId, saved),
    ),
  };
}
export function createTransfer(
  db: Database,
  identity: WriteIdentity,
  body: CreateTransfer,
) {
  return write(db, identity, "POST transfers", requestOf(body), (context) =>
    createTransferInContext(context, body),
  );
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
    requestOf(body),
    (context) => updateTransferInContext(context, id, body),
  );
}
/** Edits a transfer inside a write that is already open. */
export async function updateTransferInContext(
  context: WriteContext,
  id: string,
  body: UpdateTransfer,
) {
  const repo = transferRepository(context.tx, context.ledgerId);
  const current = pair(await repo.find(id, true));
  const version = nextVersion(current.from.version, body.expectedVersion);
  const rows = await references(context, body, current);
  const from = accountOf(rows, body.fromAccountId);
  const pricing = await priceTransfer(context, {
    from,
    to: accountOf(rows, body.toAccountId),
    amount: body.amount,
    receivedAmount: body.receivedAmount,
    date: body.date,
    manualRate: body.fxRate,
    // An edit keeps the transfer's saved rate unless it is changed by hand.
    keepRate:
      current.from.currency === from.currency ? current.from.fxRate : undefined,
  });
  const saved = await repo.update(id, body, version, pricing);
  if (body.tagIds !== undefined)
    await assignTags(
      context.tx,
      context.ledgerId,
      saved.map((row) => row.id),
      body.tagIds,
    );
  await check(context, rows);
  // An edit leaves the bonus and the fee alone; they are ordinary entries from then on.
  return {
    status: 200,
    body: dto(
      saved,
      await repo.bonus(id),
      await repo.fee(id),
      await tagsOf(context.tx, context.ledgerId, saved),
    ),
  };
}
export function transferLifecycle(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: {
    expectedVersion: number;
    deleteBonus?: boolean | undefined;
    deleteFee?: boolean | undefined;
  },
  restore: boolean,
) {
  return write(
    db,
    identity,
    `${restore ? "POST" : "DELETE"} transfers/${id.toLowerCase()}${restore ? "/restore" : ""}`,
    requestOf(body),
    (context) => transferLifecycleInContext(context, id, body, restore),
  );
}
/** Deletes or restores a transfer inside a write that is already open. */
export async function transferLifecycleInContext(
  context: WriteContext,
  id: string,
  body: {
    expectedVersion: number;
    deleteBonus?: boolean | undefined;
    deleteFee?: boolean | undefined;
  },
  restore: boolean,
) {
  const repo = transferRepository(context.tx, context.ledgerId);
  const saved = await repo.find(id, true, restore),
    current = pair(saved);
  const version = nextVersion(current.from.version, body.expectedVersion);
  if (restore && !current.from.deletedAt)
    throw new ApiProblem(409, "Conflict", "This transfer is already active.");
  const rows = await references(context, dto(saved), current);
  const deletedAt = restore ? null : new Date();
  const updated = await repo.lifecycle(id, deletedAt, version);
  // A bonus goes and comes back with its transfer (the same moment), only when asked to.
  if (restore && current.from.deletedAt) {
    await repo.bonusLifecycle(id, { restoreFrom: current.from.deletedAt });
    await repo.feeLifecycle(id, { restoreFrom: current.from.deletedAt });
  } else if (deletedAt) {
    if (body.deleteBonus) await repo.bonusLifecycle(id, { deletedAt });
    if (body.deleteFee) await repo.feeLifecycle(id, { deletedAt });
  }
  await check(context, rows);
  return restore
    ? {
        status: 200,
        body: dto(
          updated,
          await repo.bonus(id),
          await repo.fee(id),
          await tagsOf(context.tx, context.ledgerId, updated),
        ),
      }
    : { status: 204, body: null };
}
