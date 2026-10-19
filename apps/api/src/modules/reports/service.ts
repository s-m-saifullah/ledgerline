import {
  type CashFlowReport,
  monthRange,
  monthsEndingAt,
  type NetWorthReport,
  type SpendingReport,
} from "@ledgerline/shared";
import type { Database } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { accountOpeningOverview } from "../accounts/home-service";
import { categoryReportRows } from "../categories/report-service";
import { ratesUpTo } from "../currencies/service";
import { requireLedgerRead } from "../ledgers/service";
import { postedBalance } from "../transactions/balance-service";
import { spendingByCategoryMonth } from "../transactions/budget-service";
import { convertOrConflict } from "../transactions/pricing";
import {
  accountTotalsByMonth,
  cashFlowByMonth,
} from "../transactions/report-service";

function safe(value: bigint) {
  if (
    value < BigInt(Number.MIN_SAFE_INTEGER) ||
    value > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new ApiProblem(
      409,
      "Conflict",
      "A report total exceeds the supported exact money range.",
    );
  return Number(value);
}
const usd = (amount: bigint) => ({
  amount: safe(amount),
  currency: "USD" as const,
});
/** Rounded share in basis points, by integer math. */
const share = (part: bigint, total: bigint) =>
  total > 0n ? Number((part * 10000n + total / 2n) / total) : 0;

/**
 * Cleared spending for one month by category, in the base currency (frozen amounts),
 * with subcategories rolled up into their parent. Same rows as Budgets and Home.
 */
export async function getSpendingReport(
  db: Database,
  actorId: string,
  ledgerId: string,
  month: string,
): Promise<SpendingReport> {
  const range = monthRange(month);
  return db.transaction(
    async (tx) => {
      await requireLedgerRead(tx, actorId, ledgerId);
      const spent = await spendingByCategoryMonth(
        tx,
        ledgerId,
        range.start,
        range.end,
      );
      const rows = await categoryReportRows(tx, ledgerId);
      const byId = new Map(rows.map((row) => [row.id, row]));
      const own = new Map<string, bigint>();
      for (const row of spent)
        own.set(row.categoryId, (own.get(row.categoryId) ?? 0n) + row.spent);
      const total = [...own.values()].reduce((sum, value) => sum + value, 0n);
      const line = (id: string, amount: bigint) => {
        const category = byId.get(id);
        return {
          categoryId: id,
          name: category?.name ?? "Category",
          color: category?.color ?? null,
          archived: category?.archived ?? false,
          amount: usd(amount),
          shareBps: share(amount, total),
        };
      };
      const bigger = (a: { amount: bigint; name: string }, b: typeof a) =>
        a.amount === b.amount
          ? a.name.localeCompare(b.name)
          : a.amount > b.amount
            ? -1
            : 1;
      const groups = new Map<
        string,
        { id: string; amount: bigint; kids: Map<string, bigint> }
      >();
      for (const [id, amount] of own) {
        const parentId = byId.get(id)?.parentId ?? null;
        const rootId = parentId ?? id;
        const group = groups.get(rootId) ?? {
          id: rootId,
          amount: 0n,
          kids: new Map<string, bigint>(),
        };
        group.amount += amount;
        if (parentId) group.kids.set(id, amount);
        groups.set(rootId, group);
      }
      const label = (id: string) => byId.get(id)?.name ?? "";
      return {
        month,
        monthStart: range.start,
        monthEnd: range.end,
        total: usd(total),
        categories: [...groups.values()]
          .filter((group) => group.amount !== 0n)
          .sort((a, b) =>
            bigger(
              { amount: a.amount, name: label(a.id) },
              { amount: b.amount, name: label(b.id) },
            ),
          )
          .map((group) => ({
            ...line(group.id, group.amount),
            children: [...group.kids]
              .filter(([, amount]) => amount !== 0n)
              .sort(([ai, a], [bi, b]) =>
                bigger(
                  { amount: a, name: label(ai) },
                  { amount: b, name: label(bi) },
                ),
              )
              .map(([id, amount]) => line(id, amount)),
          })),
      };
    },
    { isolationLevel: "repeatable read" },
  );
}

/** Cleared income, spending and net for each of the last `months` months, zero-filled. */
export async function getCashFlowReport(
  db: Database,
  actorId: string,
  ledgerId: string,
  to: string,
  months: number,
): Promise<CashFlowReport> {
  const list = monthsEndingAt(to, months);
  const first = list[0] as string;
  return db.transaction(
    async (tx) => {
      await requireLedgerRead(tx, actorId, ledgerId);
      const rows = await cashFlowByMonth(
        tx,
        ledgerId,
        monthRange(first).start,
        monthRange(to).end,
      );
      const sum = (month: string, kind: "income" | "expense") =>
        rows
          .filter((row) => row.month === month && row.kind === kind)
          .reduce((total, row) => total + row.total, 0n);
      return {
        from: first,
        to,
        months: list.map((month) => {
          const income = sum(month, "income");
          const spending = sum(month, "expense");
          return {
            month,
            income: usd(income),
            spending: usd(spending),
            net: usd(income - spending),
          };
        }),
      };
    },
    { isolationLevel: "repeatable read" },
  );
}

/**
 * Net worth at the end of each of the last `months` months (ADR 0036): every account's
 * opening balance plus its cleared, live entries dated on or before the point, valued at the
 * newest stored rate on or before that day. A currency with no such rate is left out of that
 * point and named. The current month's point (and any later one) is as of today.
 */
export async function getNetWorthReport(
  db: Database,
  actorId: string,
  ledgerId: string,
  to: string,
  months: number,
): Promise<NetWorthReport> {
  const list = monthsEndingAt(to, months);
  const first = list[0] as string;
  const today = new Date().toISOString().slice(0, 10);
  const asOf = (month: string) => {
    const end = monthRange(month).end;
    return end < today ? end : today;
  };
  const last = asOf(to);
  return db.transaction(
    async (tx) => {
      const ledger = await requireLedgerRead(tx, actorId, ledgerId);
      const baseCurrency = ledger.baseCurrency;
      const accounts = await accountOpeningOverview(tx, ledgerId);
      const totals = await accountTotalsByMonth(
        tx,
        ledgerId,
        monthRange(first).start,
        last,
      );
      const rates = await ratesUpTo(
        tx,
        ledgerId,
        accounts.map((row) => row.currency).filter((c) => c !== baseCurrency),
        last,
      );
      const running = new Map(
        accounts.map((row) => [row.id, totals.before.get(row.id) ?? 0n]),
      );
      return {
        from: first,
        to,
        months: list.map((month) => {
          const day = asOf(month);
          const unconverted = new Set<string>();
          let total = 0n;
          for (const account of accounts) {
            const sum =
              (running.get(account.id) ?? 0n) +
              (totals.months.get(account.id)?.get(month) ?? 0n);
            running.set(account.id, sum);
            const balance = postedBalance(account.openingBalance, sum);
            if (account.currency === baseCurrency) total += BigInt(balance);
            else {
              const rate = (rates.get(account.currency) ?? []).findLast(
                (row) => row.date <= day,
              );
              // A zero balance adds nothing, so it never makes a month incomplete.
              if (rate)
                total += BigInt(
                  convertOrConflict(
                    balance,
                    rate.rate,
                    account.currency,
                    baseCurrency,
                  ),
                );
              else if (balance !== 0) unconverted.add(account.currency);
            }
          }
          return {
            month,
            asOf: day,
            netWorth: usd(total),
            unconvertedCurrencies: [...unconverted].sort(),
          };
        }),
      };
    },
    { isolationLevel: "repeatable read" },
  );
}
