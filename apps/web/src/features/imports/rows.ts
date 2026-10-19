import { currencyDigits } from "@ledgerline/shared";
import type { ImportMapping } from "./mapping";
import { parseAmount, parseDate, parseTime } from "./parse";

/** A file row read into entry fields; its category is still the file's own wording. */
export type FileRow = {
  line: number;
  date: string;
  time: string | null;
  kind: "expense" | "income";
  amount: number;
  category: string;
  subcategory: string;
  payee: string | null;
  note: string | null;
  status: "cleared" | "pending";
  tags: string[];
  sourceId: string | null;
};
export type RowNote = { line: number; reason: string };

const INCOME = new Set([
  "income",
  "credit",
  "cr",
  "deposit",
  "in",
  "+",
  "payment received",
  "received",
]);
const EXPENSE = new Set([
  "expense",
  "debit",
  "dr",
  "withdrawal",
  "out",
  "-",
  "purchase",
  "payment",
  "spending",
]);
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The apostrophe an export puts in front of text that could run as a spreadsheet formula. */
const unguard = (value: string) =>
  /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;

/**
 * Reads the file's rows with a mapping. A row comes back as a `row`, as `skipped` (a transfer or
 * split line, not supported by import yet) or as a `problem` with the reason it cannot be read.
 * Blank lines are ignored. `line` is the row's position in the file, the header being line 1.
 */
export function readRows(
  table: string[][],
  mapping: ImportMapping,
  currency: string,
) {
  const digits = currencyDigits(currency);
  const rows: FileRow[] = [];
  const skipped: RowNote[] = [];
  const problems: RowNote[] = [];
  const start = mapping.hasHeader ? 1 : 0;
  for (let index = start; index < table.length; index++) {
    const cells = table[index] as string[];
    if (cells.every((cell) => cell.trim() === "")) continue;
    const line = index + 1;
    const cell = (at: number | null) =>
      at === null ? "" : (cells[at] ?? "").trim();
    const fail = (reason: string) => problems.push({ line, reason });
    const kindWord = cell(mapping.type).toLowerCase();
    if (mapping.amountStyle === "typed" && kindWord === "transfer") {
      skipped.push({ line, reason: "Transfers can't be imported yet." });
      continue;
    }
    if (mapping.splitLine !== null && cell(mapping.splitLine) !== "") {
      skipped.push({ line, reason: "Split entries can't be imported yet." });
      continue;
    }
    const date = parseDate(cell(mapping.date), mapping.dateFormat);
    if (!date) {
      fail(
        cell(mapping.date)
          ? "The date isn't readable in the chosen format."
          : "The date is missing.",
      );
      continue;
    }
    let time: string | null = null;
    if (cell(mapping.time)) {
      time = parseTime(cell(mapping.time));
      if (!time) {
        fail("The time isn't readable.");
        continue;
      }
    }
    let kind: "expense" | "income";
    let amount: number;
    if (mapping.amountStyle === "split") {
      const money = { in: cell(mapping.moneyIn), out: cell(mapping.moneyOut) };
      const parsed = {
        in: money.in ? parseAmount(money.in, mapping.decimal, digits) : 0,
        out: money.out ? parseAmount(money.out, mapping.decimal, digits) : 0,
      };
      if (parsed.in === null || parsed.out === null) {
        fail("An amount isn't readable.");
        continue;
      }
      if (parsed.in !== 0 && parsed.out !== 0) {
        fail("Both money in and money out are filled.");
        continue;
      }
      if (parsed.in === 0 && parsed.out === 0) {
        fail("There is no amount.");
        continue;
      }
      kind = parsed.in !== 0 ? "income" : "expense";
      amount = Math.abs(parsed.in !== 0 ? parsed.in : parsed.out);
    } else {
      const parsed = parseAmount(cell(mapping.amount), mapping.decimal, digits);
      if (parsed === null) {
        fail(
          cell(mapping.amount)
            ? "The amount isn't readable."
            : "The amount is missing.",
        );
        continue;
      }
      if (parsed === 0) {
        fail("The amount is zero.");
        continue;
      }
      if (mapping.amountStyle === "typed") {
        if (INCOME.has(kindWord)) kind = "income";
        else if (EXPENSE.has(kindWord)) kind = "expense";
        else {
          fail(
            kindWord
              ? `Don't know whether "${cell(mapping.type)}" is income or expense.`
              : "The type is missing.",
          );
          continue;
        }
      } else {
        const negative = mapping.positiveIsSpending ? parsed > 0 : parsed < 0;
        kind = negative ? "expense" : "income";
      }
      amount = Math.abs(parsed);
    }
    let status: "cleared" | "pending" = "cleared";
    const statusWord = cell(mapping.status).toLowerCase();
    if (statusWord === "pending") status = "pending";
    else if (
      statusWord &&
      statusWord !== "cleared" &&
      statusWord !== "posted"
    ) {
      fail(`Don't know the status "${cell(mapping.status)}".`);
      continue;
    }
    const text = (at: number | null) => unguard(cell(at)) || null;
    const payee = text(mapping.payee);
    const note = text(mapping.note);
    if ((payee?.length ?? 0) > 200 || (note?.length ?? 0) > 2000) {
      fail("The payee or note is too long.");
      continue;
    }
    // Names split on ; or , and without repeats (ignoring case); the server checks each name.
    const tags: string[] = [];
    for (const part of unguard(cell(mapping.tags)).split(/[;,]/)) {
      const name = part.trim();
      if (name && !tags.some((t) => t.toLowerCase() === name.toLowerCase()))
        tags.push(name);
    }
    if (tags.length > 10) {
      fail("An entry can have at most 10 tags.");
      continue;
    }
    const sourceId = cell(mapping.id);
    rows.push({
      line,
      date,
      time,
      kind,
      amount,
      category: unguard(cell(mapping.category)),
      subcategory: unguard(cell(mapping.subcategory)),
      payee,
      note,
      status,
      tags,
      sourceId: ID.test(sourceId) ? sourceId.toLowerCase() : null,
    });
  }
  return { rows, skipped, problems };
}
