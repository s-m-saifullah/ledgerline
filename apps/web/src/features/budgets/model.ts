import type { BudgetLine } from "@ledgerline/shared";
import { type LimitState, limitState } from "@ledgerline/ui";

/** The part of an allowance that is used, from 0 to 1. Nothing allowed and something spent is a full bar. */
export function shareOf(spent: number, allowance: number) {
  if (allowance <= 0) return spent > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, spent / allowance));
}

/** What a category may spend this month: its budget plus what was carried in. */
export function allowanceOf(line: BudgetLine) {
  return line.budget ? line.budget.amount.amount + line.carriedIn.amount : 0;
}

/** How much of the month's allowance (budget plus carried-in) is used, capped to the bar. */
export function usedShare(line: BudgetLine) {
  if (!line.budget) return 0;
  return shareOf(line.spent.amount, allowanceOf(line));
}

/** The bar's colour: the accent, the warning from 90 per cent, red over the allowance. */
export function lineState(line: BudgetLine): LimitState {
  const allowance = allowanceOf(line);
  if (line.spent.amount > allowance) return "over";
  return limitState(line.spent.amount, allowance);
}

/** Overspent first, then the most spent; the sort is stable, so the server's order decides between equal lines. */
export function orderedLines(items: BudgetLine[]) {
  const over = (line: BudgetLine) => (line.left?.amount ?? 0) < 0;
  return items
    .filter((line) => line.budget)
    .sort(
      (a, b) =>
        Number(over(b)) - Number(over(a)) || b.spent.amount - a.spent.amount,
    );
}

/** The lines with a budget, in order, and the rest, which the page folds into one row. */
export function splitLines(items: BudgetLine[]) {
  return {
    budgeted: orderedLines(items),
    unbudgeted: items.filter((line) => !line.budget),
  };
}

/** Whole percent used, which may pass 100 when the month is overspent. */
export function percentUsed({
  spent,
  allowance,
}: {
  spent: number;
  allowance: number;
}) {
  if (allowance <= 0) return spent > 0 ? 100 : 0;
  return Math.round((spent / allowance) * 100);
}

/** The days after today in this calendar month, or null for any other month. */
export function daysLeft(month: string, today: Date) {
  const [year, index] = month.split("-").map(Number);
  if (year !== today.getFullYear() || index !== today.getMonth() + 1)
    return null;
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return last.getDate() - today.getDate();
}
