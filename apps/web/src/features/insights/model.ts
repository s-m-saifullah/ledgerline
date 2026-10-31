import {
  type Account,
  type CashFlowReport,
  isAssetAccountType,
} from "@ledgerline/shared";

/** A share of the total with one decimal, as the list says it: "35.5%". */
export const percentOf = (cents: number, total: number) =>
  total > 0 ? `${((cents * 100) / total).toFixed(1)}%` : "0.0%";

/** How much of the money in was kept, in whole per cent; nothing without money in or when more went out. */
export function keptPercent(income: number, spent: number) {
  if (income <= 0 || spent > income) return null;
  return Math.round(((income - spent) * 100) / income);
}

export type SummaryBar =
  | { kind: "none" }
  | { kind: "split"; spent: number }
  | { kind: "over" };

/** The summary's bar: nothing without money in, spent against kept, or all red when more went out than came in. */
export function summaryBar(income: number, spent: number): SummaryBar {
  if (income <= 0) return { kind: "none" };
  if (spent > income) return { kind: "over" };
  return { kind: "split", spent: spent / income };
}

/** The first five categories take the five chart colours (tints of the accent); the rest share the neutral one. */
export const categoryColour = (index: number) =>
  index < 5 ? `var(--chart-${index + 1})` : "var(--neutral-chart)";

/**
 * The cash flow report from the month the ledger started to be used: earlier months are left out, as the net worth
 * report leaves them out (ADR 0036), so both charts and their figures begin on the same month. `undefined` is
 * "not known yet" and leaves the report whole; `null` is a ledger with no accounts or entries, which has no months.
 */
export function fromHistory(
  report: CashFlowReport,
  historyStart: string | null | undefined,
): CashFlowReport {
  if (historyStart === undefined) return report;
  return {
    ...report,
    months:
      historyStart === null
        ? []
        : report.months.filter((row) => row.month >= historyStart),
  };
}

/** A month with money in or spending. */
export const activeMonths = (report: CashFlowReport) =>
  report.months.filter(
    (row) => row.income.amount > 0 || row.spending.amount > 0,
  ).length;

/** The 12-month chart is for two or more active months: one month is already the summary card. */
export const showCashFlow = (report: CashFlowReport) =>
  activeMonths(report) >= 2;

/** A bar's height in per cent of the peak: at least 2 for any money, none for nothing. */
export const barHeight = (cents: number, peak: number) =>
  cents > 0 && peak > 0 ? Math.max(2, (cents * 100) / peak) : 0;

/** Where a net worth bar sits, in per cent of the chart: above the zero line when positive, below when negative. */
export function worthBar(cents: number, high: number, low: number) {
  const range = high - low;
  if (range === 0) return { bottom: 0, height: 0 };
  const edge = cents >= 0 ? 0 : cents;
  return {
    bottom: ((edge - low) * 100) / range,
    height: cents === 0 ? 0 : Math.max(1, (Math.abs(cents) * 100) / range),
  };
}

/** Where the zero line sits, in per cent of the chart. */
export const zeroAt = (high: number, low: number) =>
  high === low ? 0 : ((0 - low) * 100) / (high - low);

export type WorthSnapshot = {
  assets: { amount: number; currency: string };
  liabilities: { amount: number; currency: string };
  net: { amount: number; currency: string };
};

/**
 * What is held and what is owed today, from the account balances (archived ones included, as the server's net
 * worth counts them): money to hand, then cards and loans as a negative figure. Null with no accounts, and null
 * in more than one currency: adding those needs exchange rates, which only the server has, and a figure that does
 * not match the chart would be worse than none (as on the phone).
 */
export function worthSnapshot(accounts: Account[]): WorthSnapshot | null {
  const currency = [...new Set(accounts.map((row) => row.balance.currency))];
  const only = currency.length === 1 ? currency[0] : undefined;
  if (!only) return null;
  const sum = (rows: Account[]) =>
    rows.reduce((total, row) => total + row.balance.amount, 0);
  const assets = sum(accounts.filter((row) => isAssetAccountType(row.type)));
  const liabilities = sum(
    accounts.filter((row) => !isAssetAccountType(row.type)),
  );
  return {
    assets: { amount: assets, currency: only },
    liabilities: { amount: liabilities, currency: only },
    net: { amount: assets + liabilities, currency: only },
  };
}
