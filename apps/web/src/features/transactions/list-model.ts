import type { Money, Transaction } from "@ledgerline/shared";
import type { TransactionFilters } from "./filters";

/** What the Filters sheet owns. The search and the kind chips apply at once and are not part of it. */
export type SheetFilters = Pick<
  TransactionFilters,
  "accountId" | "categoryId" | "tagId" | "from" | "to" | "status"
>;
const sheetKeys = [
  "accountId",
  "categoryId",
  "tagId",
  "from",
  "to",
  "status",
] as const;

/** How many of the sheet's filters are set, for the count on the Filters button. A category counts once. */
export function countFilters(filters: TransactionFilters) {
  return sheetKeys.filter((key) => !!filters[key]).length;
}
/** Whether anything is applied at all (the search, a chip or a sheet filter), for Clear filters. */
export function hasAnyFilter(filters: TransactionFilters) {
  return Object.values(filters).some(
    (value) => value !== undefined && value !== "",
  );
}
/** The sheet's own fields, as the draft the sheet starts from. */
export function sheetFilters(filters: TransactionFilters): SheetFilters {
  const draft: SheetFilters = {};
  for (const key of sheetKeys) {
    const value = filters[key];
    if (value) Object.assign(draft, { [key]: value });
  }
  return draft;
}
/** The filters after Apply: the sheet's draft over the search and the kind, which stay. */
export function nextFilters(
  current: TransactionFilters,
  draft: SheetFilters,
): TransactionFilters {
  const next: TransactionFilters = {};
  if (current.text) next.text = current.text;
  if (current.kind) next.kind = current.kind;
  for (const key of sheetKeys) {
    const value = draft[key];
    if (value) Object.assign(next, { [key]: value });
  }
  // Picking a category finds its subcategories' entries too.
  if (next.categoryId) next.includeSubcategories = true;
  return next;
}

export type ListEntry =
  | { kind: "single"; row: Transaction }
  | { kind: "transfer"; from: Transaction; to: Transaction };
export type ListDay = {
  date: string;
  entries: ListEntry[];
  /** Cleared income and expenses added up per currency; empty when there is nothing to add or the day may still be loading. */
  net: Money[];
};

/** Two legs of one transfer read as one row only when they are plainly the two halves: one out, one in, the same amount and currency. */
function pairOf(legs: Transaction[]) {
  if (legs.length !== 2) return null;
  const [a, b] = legs as [Transaction, Transaction];
  const from = a.amount.amount < 0 ? a : b;
  const to = from === a ? b : a;
  if (from.amount.currency !== to.amount.currency) return null;
  if (-from.amount.amount !== to.amount.amount) return null;
  return { from, to };
}

/**
 * The loaded rows (newest first) as days of entries. A transfer's two legs become one entry once both are loaded;
 * a lone leg stays a row of its own. While more rows may come (`hasMore`), the oldest day may be partial, so it
 * has no net yet.
 */
export function groupDays(
  rows: readonly Transaction[],
  hasMore: boolean,
): ListDay[] {
  const legsByTransfer = new Map<string, Transaction[]>();
  for (const row of rows)
    if (row.transferId) {
      const legs = legsByTransfer.get(row.transferId) ?? [];
      legs.push(row);
      legsByTransfer.set(row.transferId, legs);
    }
  const days: ListDay[] = [];
  const placed = new Set<string>();
  for (const row of rows) {
    let day = days.find((candidate) => candidate.date === row.date);
    if (!day) {
      day = { date: row.date, entries: [], net: [] };
      days.push(day);
    }
    const pair = row.transferId
      ? pairOf(legsByTransfer.get(row.transferId) ?? [])
      : null;
    if (pair && row.transferId) {
      if (placed.has(row.transferId)) continue;
      placed.add(row.transferId);
      day.entries.push({ kind: "transfer", ...pair });
    } else day.entries.push({ kind: "single", row });
  }
  for (const [index, day] of days.entries()) {
    if (hasMore && index === days.length - 1) continue;
    const totals = new Map<string, number>();
    for (const row of rows)
      if (
        row.date === day.date &&
        row.kind !== "transfer" &&
        row.status !== "pending"
      )
        totals.set(
          row.amount.currency,
          (totals.get(row.amount.currency) ?? 0) + row.amount.amount,
        );
    day.net = [...totals].map(([currency, amount]) => ({ amount, currency }));
  }
  return days;
}
