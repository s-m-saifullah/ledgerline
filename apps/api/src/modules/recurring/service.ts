import {
  type CreateRecurringRule,
  feeFromBps,
  firstOccurrenceOnOrAfter,
  type RecurringRule,
  type RecurringRun,
  recurringRuleSchema,
  recurringRunSchema,
  type UpdateRecurringRule,
} from "@ledgerline/shared";
import type { Database, DatabaseConnection } from "../../db/client";
import { localDate } from "../../jobs/local-date";
import { ApiProblem } from "../../lib/problem";
import { lockTransactionAccounts } from "../accounts/service";
import { validateTransactionCategory } from "../categories/service";
import { requireLedgerRead, requireLedgerWrite } from "../ledgers/service";
import {
  runFinancialWrite,
  type WriteContext,
  type WriteIdentity,
  type WriteResponse,
} from "../writes/service";
import { nextVersion, requireVersionUpdate } from "../writes/version";
import {
  type NewRule,
  type RuleRow,
  type RunRow,
  recurringRepository,
} from "./repo";

export type Clock = () => Date;
const RUN_LIST_LIMIT = 100;

function conflict(field: string, message: string): never {
  throw new ApiProblem(409, "Conflict", message, [{ field, message }]);
}
function ruleDto(row: RuleRow, needsAttention: number): RecurringRule {
  return recurringRuleSchema.parse({
    id: row.id,
    ledgerId: row.ledgerId,
    title: row.title,
    kind: row.kind,
    accountId: row.accountId,
    toAccountId: row.toAccountId,
    categoryId: row.categoryId,
    amount: { amount: row.amount, currency: row.currency },
    receivedAmount:
      row.receivedAmount === null || row.receivedCurrency === null
        ? null
        : { amount: row.receivedAmount, currency: row.receivedCurrency },
    bonus:
      row.bonusAmount === null ||
      row.bonusCurrency === null ||
      row.bonusCategoryId === null
        ? null
        : {
            amount: { amount: row.bonusAmount, currency: row.bonusCurrency },
            categoryId: row.bonusCategoryId,
          },
    fee:
      row.feeCategoryId === null
        ? null
        : row.feeAmount !== null
          ? {
              amount: { amount: row.feeAmount, currency: row.currency },
              categoryId: row.feeCategoryId,
            }
          : { basisPoints: row.feeBps ?? 0, categoryId: row.feeCategoryId },
    payee: row.payee,
    note: row.note,
    frequency: row.frequency,
    interval: row.interval,
    startDate: row.startDate,
    endDate: row.endDate,
    nextDate: row.nextDate,
    paused: row.pausedAt !== null,
    pausedReason: row.pausedReason,
    needsAttention,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
function runDto(row: RunRow): RecurringRun {
  return recurringRunSchema.parse({
    id: row.id,
    ruleId: row.ruleId,
    date: row.occurrenceDate,
    status: row.status,
    reason: row.reason,
    transactionId: row.transactionId,
    transferId: row.transferId,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
type RuleInput = CreateRecurringRule;
const columns = (body: RuleInput) => ({
  title: body.title,
  kind: body.kind,
  accountId: body.accountId,
  toAccountId: body.toAccountId,
  categoryId: body.categoryId,
  amount: body.amount.amount,
  currency: body.amount.currency,
  receivedAmount: body.receivedAmount?.amount ?? null,
  receivedCurrency: body.receivedAmount?.currency ?? null,
  bonusAmount: body.bonus?.amount.amount ?? null,
  bonusCurrency: body.bonus?.amount.currency ?? null,
  bonusCategoryId: body.bonus?.categoryId ?? null,
  feeAmount: body.fee && "amount" in body.fee ? body.fee.amount.amount : null,
  feeBps: body.fee && "basisPoints" in body.fee ? body.fee.basisPoints : null,
  feeCategoryId: body.fee?.categoryId ?? null,
  payee: body.payee,
  note: body.note,
  frequency: body.frequency,
  interval: body.interval,
  startDate: body.startDate,
  endDate: body.endDate,
});

/** The ledger's time zone must be set before anything runs on a schedule (ADR 0024). */
function requireTimeZone(timeZone: string | null): string {
  if (!timeZone)
    conflict(
      "timeZone",
      "Set the ledger time zone in More before creating recurring entries.",
    );
  return timeZone;
}
/** Checks the template against the ledger now so mistakes show when the rule is saved. */
async function validateTemplate(context: WriteContext, body: RuleInput) {
  const accounts = await lockTransactionAccounts(context.tx, context.ledgerId, [
    body.accountId,
    ...(body.toAccountId ? [body.toAccountId] : []),
  ]);
  const find = (id: string) =>
    accounts.find((account) => account.id === id.toLowerCase());
  const from = find(body.accountId);
  const to = body.toAccountId ? find(body.toAccountId) : undefined;
  for (const [field, account] of [
    ["accountId", from],
    ["toAccountId", to],
  ] as const)
    if (account?.archivedAt) conflict(field, "Choose an active account.");
  if (from && body.amount.currency !== from.currency)
    conflict("amount", "Use the account's currency for the amount.");
  if (body.kind === "transfer" && from && to) {
    if (from.currency === to.currency) {
      if (body.receivedAmount)
        conflict(
          "receivedAmount",
          "Both accounts use the same currency, so nothing else arrives.",
        );
    } else if (!body.receivedAmount)
      conflict("receivedAmount", "Enter the amount that arrives.");
    else if (body.receivedAmount.currency !== to.currency)
      conflict(
        "receivedAmount",
        "Use the receiving account's currency for the amount that arrives.",
      );
    if (body.fee) {
      // The fee is charged to the sending account, in its currency (ADR 0025).
      if ("amount" in body.fee && body.fee.amount.currency !== from.currency)
        conflict(
          "fee.amount",
          "Use the sending account's currency for the fee.",
        );
      if (
        "basisPoints" in body.fee &&
        feeFromBps(body.amount.amount, body.fee.basisPoints) < 1
      )
        conflict("fee", "That fee comes to less than the smallest unit.");
    }
    if (body.bonus && body.bonus.amount.currency !== to.currency)
      conflict(
        "bonus.amount",
        "Use the receiving account's currency for the bonus.",
      );
  }
  if (body.kind !== "transfer" && body.categoryId)
    await validateTransactionCategory(
      context.tx,
      context.ledgerId,
      body.categoryId,
      body.kind,
      true,
    );
  if (body.fee)
    await validateTransactionCategory(
      context.tx,
      context.ledgerId,
      body.fee.categoryId,
      "expense",
      true,
    );
  if (body.bonus)
    await validateTransactionCategory(
      context.tx,
      context.ledgerId,
      body.bonus.categoryId,
      "income",
      true,
    );
}
/** First occurrence on or after `from` that is not past the end date. */
function nextFrom(
  body: Pick<RuleInput, "frequency" | "interval" | "startDate" | "endDate">,
  from: string,
): string | null {
  const found = firstOccurrenceOnOrAfter(body, from);
  if (!found) return null;
  return body.endDate && found.date > body.endDate ? null : found.date;
}
const later = (a: string, b: string) => (a > b ? a : b);

function write(
  db: Database,
  identity: WriteIdentity,
  operation: string,
  request: Parameters<typeof runFinancialWrite>[1]["request"],
  mutate: (context: WriteContext) => Promise<WriteResponse>,
) {
  return runFinancialWrite(db, { ...identity, operation, request }, mutate);
}
const requestOf = (body: object) =>
  JSON.parse(JSON.stringify(body)) as Parameters<
    typeof runFinancialWrite
  >[1]["request"];

async function counts(db: DatabaseConnection, ledgerId: string) {
  return recurringRepository(db, ledgerId).attentionCounts();
}
export async function listRules(
  db: Database,
  actorId: string,
  ledgerId: string,
) {
  await requireLedgerRead(db, actorId, ledgerId);
  const repo = recurringRepository(db, ledgerId);
  const [rows, attention] = await Promise.all([
    repo.list(),
    counts(db, ledgerId),
  ]);
  return { items: rows.map((row) => ruleDto(row, attention.get(row.id) ?? 0)) };
}
export async function getRule(
  db: Database,
  actorId: string,
  ledgerId: string,
  id: string,
) {
  await requireLedgerRead(db, actorId, ledgerId);
  const row = await recurringRepository(db, ledgerId).find(id);
  if (!row) throw new ApiProblem(404, "Not found", "Rule not found.");
  return ruleDto(row, (await counts(db, ledgerId)).get(row.id) ?? 0);
}
export async function listRuns(
  db: Database,
  actorId: string,
  ledgerId: string,
  ruleId: string,
) {
  await requireLedgerRead(db, actorId, ledgerId);
  const repo = recurringRepository(db, ledgerId);
  if (!(await repo.find(ruleId)))
    throw new ApiProblem(404, "Not found", "Rule not found.");
  return { items: (await repo.runsOf(ruleId, RUN_LIST_LIMIT)).map(runDto) };
}

export function createRule(
  db: Database,
  identity: WriteIdentity,
  body: CreateRecurringRule,
) {
  return write(
    db,
    identity,
    "POST recurring-rules",
    requestOf(body),
    async (context) => {
      const ledger = await requireLedgerWrite(
        context.tx,
        context.actorId,
        context.ledgerId,
      );
      requireTimeZone(ledger.timeZone);
      await validateTemplate(context, body);
      const values: NewRule = {
        ...columns(body),
        createdBy: context.actorId,
        // The first occurrence is the start date; a start in the past is caught up by the runner.
        nextDate: body.startDate,
        pausedAt: null,
        pausedReason: null,
      };
      const row = await recurringRepository(
        context.tx,
        context.ledgerId,
      ).create(values);
      if (!row) throw new Error("Rule was not created");
      return { status: 201, body: ruleDto(row, 0) };
    },
  );
}

const scheduleOf = (body: RuleInput | RuleRow) => ({
  frequency: body.frequency,
  interval: body.interval,
  startDate: body.startDate,
  endDate: body.endDate,
});
export function updateRule(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: UpdateRecurringRule,
  now: Clock,
) {
  const { expectedVersion, ...fields } = body;
  return write(
    db,
    identity,
    `PATCH recurring-rules/${id.toLowerCase()}`,
    requestOf(body),
    async (context) => {
      const ledger = await requireLedgerWrite(
        context.tx,
        context.actorId,
        context.ledgerId,
      );
      const zone = requireTimeZone(ledger.timeZone);
      const repo = recurringRepository(context.tx, context.ledgerId);
      const current = await repo.find(id);
      if (!current) throw new ApiProblem(404, "Not found", "Rule not found.");
      const version = nextVersion(current.version, expectedVersion);
      await validateTemplate(context, fields);
      const before = scheduleOf(current);
      const after = scheduleOf(fields);
      const changed = JSON.stringify(before) !== JSON.stringify(after);
      let nextDate = current.nextDate;
      if (changed) {
        // Edits never rewrite the past: with nothing created yet the schedule starts over from
        // its start date, otherwise it carries on from today (ADR 0024).
        const from = (await repo.hasRuns(id))
          ? later(localDate(now(), zone), fields.startDate)
          : fields.startDate;
        nextDate = nextFrom(fields, from);
      }
      const row = requireVersionUpdate(
        await repo.update(
          id,
          expectedVersion,
          { ...columns(fields), nextDate },
          version,
        ),
      );
      return {
        status: 200,
        body: ruleDto(
          row,
          (await counts(context.tx, context.ledgerId)).get(id) ?? 0,
        ),
      };
    },
  );
}
export function pauseRule(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: { expectedVersion: number },
) {
  return write(
    db,
    identity,
    `POST recurring-rules/${id.toLowerCase()}/pause`,
    body,
    async (context) => {
      await requireLedgerWrite(context.tx, context.actorId, context.ledgerId);
      const repo = recurringRepository(context.tx, context.ledgerId);
      const current = await repo.find(id);
      if (!current) throw new ApiProblem(404, "Not found", "Rule not found.");
      if (current.pausedAt) conflict("paused", "This rule is already paused.");
      const row = requireVersionUpdate(
        await repo.update(
          id,
          body.expectedVersion,
          { pausedAt: new Date(), pausedReason: "manual" },
          nextVersion(current.version, body.expectedVersion),
        ),
      );
      return {
        status: 200,
        body: ruleDto(
          row,
          (await counts(context.tx, context.ledgerId)).get(id) ?? 0,
        ),
      };
    },
  );
}
export function resumeRule(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: { expectedVersion: number },
  now: Clock,
) {
  return write(
    db,
    identity,
    `POST recurring-rules/${id.toLowerCase()}/resume`,
    body,
    async (context) => {
      const ledger = await requireLedgerWrite(
        context.tx,
        context.actorId,
        context.ledgerId,
      );
      const zone = requireTimeZone(ledger.timeZone);
      const repo = recurringRepository(context.tx, context.ledgerId);
      const current = await repo.find(id);
      if (!current) throw new ApiProblem(404, "Not found", "Rule not found.");
      if (!current.pausedAt) conflict("paused", "This rule is not paused.");
      // What came due while it was paused is skipped, not caught up (ADR 0024).
      const nextDate = nextFrom(
        current,
        later(localDate(now(), zone), current.startDate),
      );
      const row = requireVersionUpdate(
        await repo.update(
          id,
          body.expectedVersion,
          // Whoever resumes it is who the runner acts as from now on.
          {
            pausedAt: null,
            pausedReason: null,
            nextDate,
            createdBy: context.actorId,
          },
          nextVersion(current.version, body.expectedVersion),
        ),
      );
      return {
        status: 200,
        body: ruleDto(
          row,
          (await counts(context.tx, context.ledgerId)).get(id) ?? 0,
        ),
      };
    },
  );
}
export function deleteRule(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: { expectedVersion: number },
) {
  return write(
    db,
    identity,
    `DELETE recurring-rules/${id.toLowerCase()}`,
    body,
    async (context) => {
      await requireLedgerWrite(context.tx, context.actorId, context.ledgerId);
      const repo = recurringRepository(context.tx, context.ledgerId);
      const current = await repo.find(id);
      if (!current) throw new ApiProblem(404, "Not found", "Rule not found.");
      // Entries it already made stay; only the rule goes.
      requireVersionUpdate(
        await repo.update(
          id,
          body.expectedVersion,
          { deletedAt: new Date() },
          nextVersion(current.version, body.expectedVersion),
        ),
      );
      return { status: 204, body: null };
    },
  );
}
export function skipRun(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: { expectedVersion: number },
) {
  return write(
    db,
    identity,
    `POST recurring-runs/${id.toLowerCase()}/skip`,
    body,
    async (context) => {
      await requireLedgerWrite(context.tx, context.actorId, context.ledgerId);
      const repo = recurringRepository(context.tx, context.ledgerId);
      const current = await repo.findRun(id);
      if (!current) throw new ApiProblem(404, "Not found", "Run not found.");
      if (current.status !== "attention")
        conflict(
          "status",
          "Only an occurrence that needs attention can be skipped.",
        );
      const row = requireVersionUpdate(
        await repo.skipRun(
          id,
          body.expectedVersion,
          nextVersion(current.version, body.expectedVersion),
        ),
      );
      return { status: 200, body: runDto(row) };
    },
  );
}
