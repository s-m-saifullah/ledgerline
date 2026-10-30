import type { Transaction } from "@ledgerline/shared";
import { describe, expect, it } from "vitest";
import {
  countFilters,
  groupDays,
  hasAnyFilter,
  nextFilters,
  sheetFilters,
} from "./list-model";

let counter = 0;
type Over = Omit<Partial<Transaction>, "amount"> & {
  amount?: number;
  currency?: string;
};
function row(over: Over = {}): Transaction {
  counter++;
  const currency = over.currency ?? "USD";
  const { amount, currency: _c, ...rest } = over;
  return {
    id: `id-${counter}`,
    ledgerId: "l",
    accountId: "a1",
    categoryId: "c1",
    kind: "expense",
    date: "2026-10-05",
    time: null,
    amount: { amount: amount ?? -1000, currency },
    status: "cleared",
    payee: null,
    note: null,
    fxRate: "1",
    baseAmount: { amount: amount ?? -1000, currency: "USD" },
    transferId: null,
    relatedTransferId: null,
    feeTransferId: null,
    tipPaymentId: null,
    receivablePaymentId: null,
    receivableId: null,
    isSplit: false,
    splits: [],
    tags: [],
    version: 1,
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
    ...rest,
  } as Transaction;
}
const leg = (transferId: string, amount: number, over: Over = {}) =>
  row({ kind: "transfer", transferId, categoryId: null, amount, ...over });

describe("groupDays: days", () => {
  it("groups by date in the order given and keeps each day's order", () => {
    const a = row({ date: "2026-10-06" });
    const b = row({ date: "2026-10-05" });
    const c = row({ date: "2026-10-05" });
    const days = groupDays([a, b, c], false);
    expect(days.map((d) => d.date)).toEqual(["2026-10-06", "2026-10-05"]);
    expect(
      days[1]?.entries.map((e) => (e.kind === "single" ? e.row.id : "?")),
    ).toEqual([b.id, c.id]);
  });
});

describe("groupDays: a day's net", () => {
  it("adds cleared income and expenses per currency", () => {
    const [day] = groupDays(
      [
        row({ amount: -1000 }),
        row({ amount: 2500, kind: "income" }),
        row({ amount: -300, currency: "EUR" }),
      ],
      false,
    );
    expect(day?.net).toEqual([
      { amount: 1500, currency: "USD" },
      { amount: -300, currency: "EUR" },
    ]);
  });
  it("leaves out pending entries and transfers", () => {
    const [day] = groupDays(
      [
        row({ amount: -1000 }),
        row({ amount: -9000, status: "pending" }),
        leg("t1", -5000),
        leg("t1", 5000),
      ],
      false,
    );
    expect(day?.net).toEqual([{ amount: -1000, currency: "USD" }]);
  });
  it("leaves out a transfer even when its two legs would not cancel out", () => {
    const [day] = groupDays(
      [
        leg("t1", -5000),
        leg("t1", 4600, { currency: "EUR" }),
        row({ amount: -100 }),
      ],
      false,
    );
    expect(day?.net).toEqual([{ amount: -100, currency: "USD" }]);
  });
  it("has no net for a day with nothing to add up", () => {
    const [day] = groupDays([row({ status: "pending" })], false);
    expect(day?.net).toEqual([]);
  });
  it("keeps a day that nets to zero", () => {
    const [day] = groupDays(
      [row({ amount: -1000 }), row({ amount: 1000, kind: "income" })],
      false,
    );
    expect(day?.net).toEqual([{ amount: 0, currency: "USD" }]);
  });
  it("waits for the last day while more entries may still come", () => {
    const days = groupDays(
      [
        row({ date: "2026-10-06", amount: -100 }),
        row({ date: "2026-10-05", amount: -200 }),
      ],
      true,
    );
    expect(days[0]?.net).toEqual([{ amount: -100, currency: "USD" }]);
    expect(days[1]?.net).toEqual([]);
  });
  it("shows the last day's net once everything is loaded", () => {
    const days = groupDays([row({ date: "2026-10-05", amount: -200 })], false);
    expect(days[0]?.net).toEqual([{ amount: -200, currency: "USD" }]);
  });
});

describe("groupDays: a transfer is one row", () => {
  it("pairs the two legs, from the one that left and to the one that arrived", () => {
    const to = leg("t1", 5000, { accountId: "a2" });
    const from = leg("t1", -5000, { accountId: "a1" });
    const [day] = groupDays([to, from], false);
    expect(day?.entries).toHaveLength(1);
    const [entry] = day?.entries ?? [];
    expect(entry?.kind).toBe("transfer");
    if (entry?.kind === "transfer") {
      expect(entry.from.id).toBe(from.id);
      expect(entry.to.id).toBe(to.id);
    }
  });
  it("puts the pair where its first leg was", () => {
    const a = row();
    const out = leg("t1", -100);
    const b = row();
    const into = leg("t1", 100);
    const [day] = groupDays([a, out, b, into], false);
    expect(day?.entries.map((e) => e.kind)).toEqual([
      "single",
      "transfer",
      "single",
    ]);
  });
  it("keeps a lone leg as it is (its other leg is on the next page, or a filter hides it)", () => {
    const [day] = groupDays([leg("t1", -5000)], true);
    expect(day?.entries.map((e) => e.kind)).toEqual(["single"]);
  });
  it("keeps two rows when the amounts differ (another currency)", () => {
    const [day] = groupDays(
      [leg("t1", -5000), leg("t1", 4600, { currency: "EUR" })],
      false,
    );
    expect(day?.entries).toHaveLength(2);
  });
  it("keeps two rows when the amounts match but the currencies differ", () => {
    const [day] = groupDays(
      [leg("t1", -5000), leg("t1", 5000, { currency: "EUR" })],
      false,
    );
    expect(day?.entries).toHaveLength(2);
  });
  it("does not guess at three legs", () => {
    const [day] = groupDays(
      [leg("t1", -5000), leg("t1", 5000), leg("t1", 5000)],
      false,
    );
    expect(day?.entries).toHaveLength(3);
    expect(day?.entries.every((entry) => entry.kind === "single")).toBe(true);
  });
  it("keeps two rows when the same currency amounts differ", () => {
    const [day] = groupDays([leg("t1", -5000), leg("t1", 4900)], false);
    expect(day?.entries).toHaveLength(2);
  });
  it("pairs different transfers separately", () => {
    const [day] = groupDays(
      [leg("t1", -100), leg("t2", -200), leg("t1", 100), leg("t2", 200)],
      false,
    );
    expect(day?.entries.map((e) => e.kind)).toEqual(["transfer", "transfer"]);
  });
  it("does not pair two outgoing legs", () => {
    const [day] = groupDays([leg("t1", -100), leg("t1", -100)], false);
    expect(day?.entries).toHaveLength(2);
  });
});

describe("filters", () => {
  it("counts the filters the sheet owns, one each", () => {
    expect(countFilters({})).toBe(0);
    expect(countFilters({ accountId: "a" })).toBe(1);
    expect(
      countFilters({
        accountId: "a",
        categoryId: "c",
        tagId: "t",
        from: "2026-10-01",
        to: "2026-10-31",
        status: "pending",
      }),
    ).toBe(6);
  });
  it("does not count the search or the kind chips", () => {
    expect(countFilters({ text: "coffee", kind: "expense" })).toBe(0);
  });
  it("counts a category once even with its subcategories", () => {
    expect(countFilters({ categoryId: "c", includeSubcategories: true })).toBe(
      1,
    );
  });
  it("knows whether anything at all is set", () => {
    expect(hasAnyFilter({})).toBe(false);
    expect(hasAnyFilter({ text: "x" })).toBe(true);
    expect(hasAnyFilter({ kind: "income" })).toBe(true);
    expect(hasAnyFilter({ status: "cleared" })).toBe(true);
    expect(hasAnyFilter({ text: "" })).toBe(false);
  });
  it("takes the sheet's fields from the filters", () => {
    expect(
      sheetFilters({
        text: "x",
        kind: "income",
        accountId: "a",
        status: "pending",
      }),
    ).toEqual({ accountId: "a", status: "pending" });
  });
  it("applies a draft over the filters and keeps the search and the kind", () => {
    expect(
      nextFilters(
        { text: "x", kind: "income", accountId: "old", tagId: "t" },
        { accountId: "new", from: "2026-10-01" },
      ),
    ).toEqual({
      text: "x",
      kind: "income",
      accountId: "new",
      from: "2026-10-01",
    });
  });
  it("applies a chosen category with its subcategories", () => {
    expect(nextFilters({}, { categoryId: "c" })).toEqual({
      categoryId: "c",
      includeSubcategories: true,
    });
  });
  it("leaves out a category that was cleared", () => {
    expect(
      nextFilters({ categoryId: "c", includeSubcategories: true }, {}),
    ).toEqual({});
  });
});
