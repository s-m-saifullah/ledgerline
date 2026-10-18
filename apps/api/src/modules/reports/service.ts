import {
  type CashFlowReport,
  monthRange,
  monthsEndingAt,
  type SpendingReport,
} from "@ledgerline/shared";
import type { Database } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { categoryReportRows } from "../categories/report-service";
import { requireLedgerRead } from "../ledgers/service";
import { spendingByCategoryMonth } from "../transactions/budget-service";
import { cashFlowByMonth } from "../transactions/report-service";

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
