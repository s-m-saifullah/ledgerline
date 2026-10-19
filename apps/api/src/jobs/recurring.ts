import {
  createTransactionSchema,
  createTransferSchema,
  localDate,
  occurrenceAfter,
  occurrencesBetween,
} from "@ledgerline/shared";
import type { Database } from "../db/client";
import { ApiProblem } from "../lib/problem";
import { ledgerRepository } from "../modules/ledgers/repo";
import {
  activeRulesWithZone,
  advanceNextDate,
  attentionRuns,
  pauseForAccess,
  type RuleRow,
  recurringRepository,
} from "../modules/recurring/repo";
import { createTransaction } from "../modules/transactions/service";
import { createTransfer } from "../modules/transactions/transfer-service";
import type { JobLog } from "./runner";

/** At most this many occurrences per rule per tick; a mistaken start date cannot flood a ledger. */
export const MAX_PER_RULE = 100;
const GENERIC_REASON = "Something went wrong. It will be tried again.";

type Outcome = "created" | "attention" | "skipped";

/**
 * Creates one occurrence as the rule's creator through the ordinary write path. The key is stable
 * per rule and date, so a retry replays the saved result instead of creating a second entry, and
 * an entry the person later deletes is never recreated. The outcome is recorded either way.
 */
async function executeOccurrence(
  db: Database,
  rule: RuleRow,
  date: string,
  log: JobLog,
): Promise<Outcome> {
  const repo = recurringRepository(db, rule.ledgerId);
  const existing = await repo.findRunOn(rule.id, date);
  if (existing?.status === "skipped") return "skipped";
  const identity = {
    actorId: rule.createdBy,
    ledgerId: rule.ledgerId,
    key: `recurring-${rule.id}-${date}`,
  };
  try {
    let transactionId: string;
    let transferId: string | null = null;
    if (rule.kind === "transfer") {
      if (!rule.toAccountId)
        throw new Error("A transfer rule needs two accounts");
      const result = await createTransfer(
        db,
        identity,
        createTransferSchema.parse({
          fromAccountId: rule.accountId,
          toAccountId: rule.toAccountId,
          amount: { amount: rule.amount, currency: rule.currency },
          date,
          time: null,
          note: rule.note,
          ...(rule.tagIds.length ? { tagIds: rule.tagIds } : {}),
          ...(rule.receivedAmount !== null && rule.receivedCurrency
            ? {
                receivedAmount: {
                  amount: rule.receivedAmount,
                  currency: rule.receivedCurrency,
                },
              }
            : {}),
          ...(rule.feeCategoryId
            ? {
                fee:
                  rule.feeAmount !== null
                    ? {
                        amount: {
                          amount: rule.feeAmount,
                          currency: rule.currency,
                        },
                        categoryId: rule.feeCategoryId,
                      }
                    : {
                        basisPoints: rule.feeBps ?? 0,
                        categoryId: rule.feeCategoryId,
                      },
              }
            : {}),
          ...(rule.bonusAmount !== null &&
          rule.bonusCurrency &&
          rule.bonusCategoryId
            ? {
                bonus: {
                  amount: {
                    amount: rule.bonusAmount,
                    currency: rule.bonusCurrency,
                  },
                  categoryId: rule.bonusCategoryId,
                },
              }
            : {}),
        }),
      );
      const body = result.body as { id: string; fromTransactionId: string };
      transferId = body.id;
      transactionId = body.fromTransactionId;
    } else {
      const result = await createTransaction(
        db,
        identity,
        createTransactionSchema.parse({
          accountId: rule.accountId,
          categoryId: rule.categoryId,
          kind: rule.kind,
          date,
          amount: { amount: rule.amount, currency: rule.currency },
          status: "cleared",
          payee: rule.payee,
          note: rule.note,
          ...(rule.tagIds.length ? { tagIds: rule.tagIds } : {}),
        }),
      );
      transactionId = (result.body as { id: string }).id;
    }
    await repo.saveRun({
      ruleId: rule.id,
      occurrenceDate: date,
      status: "created",
      reason: null,
      transactionId,
      transferId,
    });
    return "created";
  } catch (failure) {
    // Expected failures carry fixed, non-sensitive sentences; anything else gets a generic one.
    const reason =
      failure instanceof ApiProblem && failure.statusCode < 500
        ? failure.detail.slice(0, 200)
        : GENERIC_REASON;
    if (!(failure instanceof ApiProblem))
      log.error({ ruleId: rule.id }, "Recurring occurrence failed");
    await repo.saveRun({
      ruleId: rule.id,
      occurrenceDate: date,
      status: "attention",
      reason,
      transactionId: null,
      transferId: null,
    });
    return "attention";
  }
}

async function canWrite(db: Database, rule: RuleRow) {
  const ledger = await ledgerRepository(db, rule.createdBy).find(rule.ledgerId);
  return ledger?.role === "owner" || ledger?.role === "editor";
}

/**
 * Creates every occurrence that has come due, up to today in each ledger's time zone, then retries
 * the ones that needed attention. What is due is worked out from the rules themselves, so a missed
 * tick or a long outage is caught up on the next run. Only counts are logged.
 */
export async function runRecurringRules(
  db: Database,
  now: Date,
  log: JobLog,
  only?: { ledgerId?: string; ruleId?: string },
) {
  const summary = { rules: 0, created: 0, attention: 0, paused: 0 };
  // Occurrences handled in this run are not retried again straight away.
  const handled = new Set<string>();
  for (const { rule, timeZone } of await activeRulesWithZone(db, only)) {
    if (!rule.nextDate || !timeZone) continue;
    const today = localDate(now, timeZone);
    if (rule.nextDate > today) continue;
    summary.rules++;
    if (!(await canWrite(db, rule))) {
      await pauseForAccess(db, rule);
      summary.paused++;
      continue;
    }
    const last = rule.endDate && rule.endDate < today ? rule.endDate : today;
    let cursor = rule.nextDate;
    for (const date of occurrencesBetween(
      rule,
      rule.nextDate,
      last,
      MAX_PER_RULE,
    )) {
      handled.add(`${rule.id}:${date}`);
      const outcome = await executeOccurrence(db, rule, date, log);
      if (outcome === "created") summary.created++;
      if (outcome === "attention") summary.attention++;
      const following = occurrenceAfter(rule, date);
      const next =
        following && (!rule.endDate || following <= rule.endDate)
          ? following
          : null;
      // An edit made meanwhile wins: stop if the next date is no longer the one we started from.
      if (!(await advanceNextDate(db, rule, cursor, next))) break;
      if (!next) break;
      cursor = next;
    }
  }
  for (const { run, rule } of await attentionRuns(db, only)) {
    if (handled.has(`${rule.id}:${run.occurrenceDate}`)) continue;
    if (!(await canWrite(db, rule))) continue;
    if (
      (await executeOccurrence(db, rule, run.occurrenceDate, log)) === "created"
    )
      summary.created++;
  }
  if (summary.created || summary.attention || summary.paused)
    log.info(summary, "Recurring entries run finished");
  return summary;
}
