import { type Category, newId } from "@ledgerline/shared";
import { describe, expect, it } from "vitest";
import { categoryNeeds, categoryWording, matchCategory } from "./categories";
import { type CategoryChoices, toImportRows } from "./payload";
import type { FileRow } from "./rows";

const cat = (
  name: string,
  kind: Category["kind"],
  extra: Partial<Category> = {},
) =>
  ({
    id: newId(),
    name,
    kind,
    parentId: null,
    archivedAt: null,
    sortOrder: 0,
    version: 1,
    ...extra,
  }) as Category;
const food = cat("Food", "expense");
const groceries = cat("Groceries", "expense", { parentId: food.id });
const fun = cat("Fun", "expense");
const salary = cat("Salary", "income");
const old = cat("Old", "expense", { archivedAt: "2026-01-01T00:00:00.000Z" });
const dup = cat("Food", "income");
const all = [food, groceries, fun, salary, old, dup];
const row = (over: Partial<FileRow> = {}): FileRow => ({
  line: 2,
  date: "2026-10-05",
  time: null,
  kind: "expense",
  amount: 100,
  category: "",
  subcategory: "",
  payee: null,
  note: null,
  status: "cleared",
  tags: [],
  sourceId: null,
  ...over,
});

describe("matchCategory", () => {
  it("matches by name, full path or unique child name, per direction, ignoring case", () => {
    expect(matchCategory("expense", "food", all)?.id).toBe(food.id);
    expect(matchCategory("income", "Food", all)?.id).toBe(dup.id);
    expect(matchCategory("expense", "Food / Groceries", all)?.id).toBe(
      groceries.id,
    );
    expect(matchCategory("expense", "groceries", all)?.id).toBe(groceries.id);
    expect(matchCategory("expense", "Salary", all)).toBeNull();
    expect(matchCategory("expense", "Old", all)).toBeNull();
    expect(matchCategory("expense", "  ", all)).toBeNull();
    expect(matchCategory("expense", "Travel", all)).toBeNull();
  });
});

describe("categoryNeeds and toImportRows", () => {
  const rows = [
    row({ line: 2, category: "Food", subcategory: "Groceries" }),
    row({ line: 3, category: "Fun" }),
    row({ line: 4, category: "Travel" }),
    row({ line: 5, category: "Travel" }),
    row({ line: 6 }),
    row({ line: 7, kind: "income", amount: 5, category: "Salary" }),
  ];
  it("lists each wording once with its automatic match, and counts rows with none", () => {
    const needs = categoryNeeds(rows, all);
    expect(categoryWording(rows[0] as FileRow)).toBe("Food / Groceries");
    expect(needs.blank).toEqual({ expense: 1, income: 0 });
    expect(
      needs.wordings.map((w) => [w.wording, w.rows, w.match?.name ?? null]),
    ).toEqual([
      ["Food / Groceries", 1, "Groceries"],
      ["Fun", 1, "Fun"],
      ["Travel", 2, null],
      ["Salary", 1, "Salary"],
    ]);
  });
  it("needs a choice for unmatched wordings and blank categories, then maps every row", () => {
    const none: CategoryChoices = {
      byWording: {},
      defaults: { expense: null, income: null },
    };
    expect(toImportRows(rows, all, none).unresolved).toEqual([4, 5, 6]);
    const chosen: CategoryChoices = {
      byWording: { "expense|travel": fun.id },
      defaults: { expense: food.id, income: null },
    };
    const result = toImportRows(rows, all, chosen);
    expect(result.unresolved).toEqual([]);
    expect(result.ready.map((r) => [r.line, r.categoryId])).toEqual([
      [2, groceries.id],
      [3, fun.id],
      [4, fun.id],
      [5, fun.id],
      [6, food.id],
      [7, salary.id],
    ]);
  });
  it("uses the default when a wording is sent there", () => {
    const result = toImportRows([row({ category: "Travel" })], all, {
      byWording: { "expense|travel": "default" },
      defaults: { expense: fun.id, income: null },
    });
    expect(result.ready[0]?.categoryId).toBe(fun.id);
  });
});
