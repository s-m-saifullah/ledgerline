import type { Account, RecurringRule } from "@ledgerline/shared";
import { everySentence, formatDate } from "./schedule";

export const kindLabel = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
} as const;

/** Where a rule stands: what it does next, or why it does not. */
export function ruleStatus(rule: RecurringRule): string {
  if (rule.paused)
    return rule.pausedReason === "access"
      ? "Paused, the person it runs as can no longer write"
      : "Paused";
  return rule.nextDate ? `Next ${formatDate(rule.nextDate)}` : "Ended";
}

/** The one hint of a row: "Expense · Every month · Next 1 Nov 2026". */
export const ruleHint = (rule: RecurringRule) =>
  `${kindLabel[rule.kind]} · ${everySentence(rule.frequency, rule.interval)} · ${ruleStatus(rule)}`;

/** What stands under the amount: entries that need a look first, otherwise the account it runs on. */
export function ruleEndHint(
  rule: Pick<RecurringRule, "needsAttention" | "accountId">,
  accounts: readonly Pick<Account, "id" | "name">[] | undefined,
): string {
  if (rule.needsAttention > 0)
    return rule.needsAttention === 1
      ? "1 needs attention"
      : `${rule.needsAttention} need attention`;
  return accounts?.find((account) => account.id === rule.accountId)?.name ?? "";
}
