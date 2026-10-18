import { parseCsv } from "@ledgerline/shared";
import { describe, expect, it } from "vitest";
import { guessMapping } from "./mapping";
import { readRows } from "./rows";
import { templateCsv } from "./template";

describe("templateCsv", () => {
  it("starts with a byte-order mark and reads back through the importer", () => {
    const text = templateCsv();
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text.endsWith("\r\n")).toBe(true);
    const table = parseCsv(text);
    const mapping = guessMapping(table);
    const { rows, problems, skipped } = readRows(table, mapping, "USD");
    expect(problems).toEqual([]);
    expect(skipped).toEqual([]);
    expect(rows).toMatchObject([
      {
        date: "2026-01-15",
        kind: "expense",
        amount: 1250,
        category: "Food",
        subcategory: "Groceries",
        payee: "Corner shop",
      },
      {
        date: "2026-01-16",
        time: "09:30",
        kind: "income",
        amount: 250000,
        category: "Salary",
        payee: "Acme Inc",
      },
    ]);
  });
});
