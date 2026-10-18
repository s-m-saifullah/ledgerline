import { parseCsv } from "@ledgerline/shared";
import { describe, expect, it } from "vitest";
import {
  detectDateFormat,
  detectDecimal,
  emptyMapping,
  guessMapping,
  type ImportMapping,
  mappingProblem,
  savedMapping,
  saveMapping,
} from "./mapping";
import { readRows } from "./rows";

describe("guessMapping", () => {
  it("recognizes the columns of this app's own export", () => {
    const table = parseCsv(
      "id,date,time,type,amount,currency,account,to_account,received_amount,category,subcategory,payee,note,status,line,fx_rate,base_amount\r\n" +
        "0198,2026-10-02,,expense,10.00,USD,Checking,,,Food,,Shop,,cleared,,1,10.00\r\n",
    );
    const mapping = guessMapping(table);
    expect(mapping).toMatchObject({
      hasHeader: true,
      date: 1,
      time: 2,
      type: 3,
      amount: 4,
      category: 9,
      subcategory: 10,
      payee: 11,
      note: 12,
      status: 13,
      id: 0,
      splitLine: 14,
      amountStyle: "typed",
      dateFormat: "iso",
      decimal: "dot",
    });
    expect(mappingProblem(mapping)).toBeNull();
  });
  it("guesses a bank file with money in and out columns and day-first dates", () => {
    const table = parseCsv(
      "Posting Date,Description,Debit,Credit,Balance\n" +
        "25/10/2026,Coffee,3.50,,100.00\n13/11/2026,Pay,,2500.00,2600.00\n",
    );
    expect(guessMapping(table)).toMatchObject({
      date: 0,
      payee: 1,
      moneyOut: 2,
      moneyIn: 3,
      amountStyle: "split",
      dateFormat: "dmy",
    });
  });
  it("treats a file with no header row as unmapped", () => {
    const mapping = guessMapping(parseCsv("2026-10-05,-12.50,Coffee\n"));
    expect(mapping.hasHeader).toBe(false);
    expect(mappingProblem(mapping)).toBe("Choose the date column.");
  });
  it("detects formats from values", () => {
    expect(detectDateFormat(["2026-10-05"])).toBe("iso");
    expect(detectDateFormat(["25/10/2026", "01/02/2026"])).toBe("dmy");
    expect(detectDateFormat(["10/25/2026"])).toBe("mdy");
    expect(detectDateFormat(["01/02/2026"])).toBe("mdy");
    expect(detectDecimal(["1.234,56", "12,50"])).toBe("comma");
    expect(detectDecimal(["1,234.56", "12.50"])).toBe("dot");
    expect(detectDecimal(["1,234", "5,000"])).toBe("dot");
    expect(detectDecimal([])).toBe("dot");
  });
  it("tells what a mapping still lacks", () => {
    const base: ImportMapping = { ...emptyMapping(true), date: 0 };
    expect(mappingProblem(base)).toBe("Choose the amount column.");
    expect(mappingProblem({ ...base, amount: 1 })).toBeNull();
    expect(mappingProblem({ ...base, amount: 1, amountStyle: "typed" })).toBe(
      "Choose the column that says income or expense.",
    );
    expect(mappingProblem({ ...base, amountStyle: "split", moneyIn: 2 })).toBe(
      "Choose the money in and money out columns.",
    );
  });
  it("remembers a mapping for the same headers on this device", () => {
    const mapping: ImportMapping = {
      ...emptyMapping(true),
      date: 0,
      amount: 1,
    };
    saveMapping(["Date", "Amount"], mapping);
    expect(savedMapping(["date", "AMOUNT"], 2)).toMatchObject({
      date: 0,
      amount: 1,
    });
    expect(savedMapping(["Date", "Amount", "Extra"], 3)).toBeNull();
    // A column that no longer exists makes the saved mapping unusable.
    saveMapping(["A", "B"], { ...mapping, amount: 5 });
    expect(savedMapping(["A", "B"], 2)).toBeNull();
  });
});

const read = (text: string, over: Partial<ImportMapping> = {}) => {
  const table = parseCsv(text);
  return readRows(table, { ...guessMapping(table), ...over }, "USD");
};

describe("readRows", () => {
  it("reads signed amounts, with the sign deciding the direction", () => {
    const { rows, problems } = read(
      "Date,Amount,Description,Memo\n2026-10-05,-12.50,Coffee,morning\n2026-10-06,2500,Pay,\n",
    );
    expect(problems).toEqual([]);
    expect(rows).toMatchObject([
      {
        line: 2,
        date: "2026-10-05",
        kind: "expense",
        amount: 1250,
        payee: "Coffee",
        note: "morning",
      },
      {
        line: 3,
        date: "2026-10-06",
        kind: "income",
        amount: 250000,
        payee: "Pay",
        note: null,
      },
    ]);
  });
  it("can treat positive amounts as spending (card statements)", () => {
    const { rows } = read("Date,Amount\n2026-10-05,12.50\n2026-10-06,-3.00\n", {
      positiveIsSpending: true,
    });
    expect(rows.map((r) => [r.kind, r.amount])).toEqual([
      ["expense", 1250],
      ["income", 300],
    ]);
  });
  it("reads money in and money out columns and flags unusable rows", () => {
    const { rows, problems } = read(
      "Date,Debit,Credit\n2026-10-05,3.50,\n2026-10-06,,2500.00\n2026-10-07,1.00,2.00\n2026-10-08,,\n2026-10-09,x,\n",
    );
    expect(rows.map((r) => [r.kind, r.amount])).toEqual([
      ["expense", 350],
      ["income", 250000],
    ]);
    expect(problems.map((p) => [p.line, p.reason])).toEqual([
      [4, "Both money in and money out are filled."],
      [5, "There is no amount."],
      [6, "An amount isn't readable."],
    ]);
  });
  it("reads a type column and its words", () => {
    const { rows, problems } = read(
      "Date,Type,Amount\n2026-10-05,Debit,3.50\n2026-10-06,CREDIT,10.00\n2026-10-07,Hold,1.00\n",
    );
    expect(rows.map((r) => r.kind)).toEqual(["expense", "income"]);
    expect(problems[0]?.reason).toContain('"Hold"');
  });
  it("reports bad dates, zero and missing amounts, long text and unknown status by line", () => {
    const { rows, problems } = read(
      `Date,Amount,Description,Status\n` +
        `soon,5,A,\n2026-10-05,0,B,\n2026-10-05,,C,\n2026-10-05,5,${"x".repeat(201)},\n2026-10-05,5,D,held\n2026-10-05,5,E,Pending\n`,
    );
    expect(problems.map((p) => p.line)).toEqual([2, 3, 4, 5, 6]);
    expect(rows).toMatchObject([{ line: 7, status: "pending" }]);
  });
  it("skips blank lines, transfers and split lines, and keeps line numbers", () => {
    const { rows, skipped } = read(
      "id,date,type,amount,category,line\n" +
        "0198aaaa-0000-7000-8000-000000000001,2026-10-05,expense,10.00,Food,\n" +
        ",,,,,\n" +
        "0198aaaa-0000-7000-8000-000000000002,2026-10-06,transfer,50.00,,\n" +
        "0198aaaa-0000-7000-8000-000000000003,2026-10-07,expense,6.00,Food,1\n" +
        "x,2026-10-08,income,9.00,Pay,\n",
    );
    expect(rows.map((r) => [r.line, r.sourceId])).toEqual([
      [2, "0198aaaa-0000-7000-8000-000000000001"],
      [6, null],
    ]);
    expect(skipped.map((s) => s.line)).toEqual([4, 5]);
  });
  it("undoes the export's formula guard and keeps the category wording", () => {
    const { rows } = read(
      "date,type,amount,category,subcategory,payee\n2026-10-05,expense,1.00,Food,Groceries,'=HYPERLINK\n",
    );
    expect(rows[0]).toMatchObject({
      category: "Food",
      subcategory: "Groceries",
      payee: "=HYPERLINK",
    });
  });
  it("reads yen without decimals and euro-style numbers", () => {
    const table = parseCsv('Date,Amount\n2026-10-05,"-1,200"\n');
    expect(readRows(table, guessMapping(table), "JPY").rows[0]).toMatchObject({
      kind: "expense",
      amount: 1200,
    });
    const euro = parseCsv("Date;Amount\n");
    expect(euro.length).toBe(1);
    const comma = parseCsv('Date,Amount\n25.10.2026,"-1.234,56"\n');
    expect(readRows(comma, guessMapping(comma), "USD").rows[0]).toMatchObject({
      date: "2026-10-25",
      amount: 123456,
    });
  });
});
