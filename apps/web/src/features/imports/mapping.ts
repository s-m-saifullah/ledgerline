/** How the columns of a CSV file map onto entries. Column numbers count from 0. */
export type AmountStyle = "signed" | "typed" | "split";
export type DateFormat = "iso" | "mdy" | "dmy";
export type DecimalStyle = "dot" | "comma";
export type ImportMapping = {
  hasHeader: boolean;
  date: number | null;
  dateFormat: DateFormat;
  time: number | null;
  amountStyle: AmountStyle;
  // One amount column (signed, or positive with a type column).
  amount: number | null;
  type: number | null;
  // Separate money in and money out columns.
  moneyIn: number | null;
  moneyOut: number | null;
  // Signed amounts where a positive number is spending (some card statements).
  positiveIsSpending: boolean;
  decimal: DecimalStyle;
  category: number | null;
  subcategory: number | null;
  payee: number | null;
  note: number | null;
  status: number | null;
  // Tag names, separated by ; or , (ADR 0035).
  tags: number | null;
  id: number | null;
  // The export's split-line number; rows with one are split entries, which import skips.
  splitLine: number | null;
};

const normal = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
const NAMES = {
  date: [
    "date",
    "transactiondate",
    "postingdate",
    "posteddate",
    "bookingdate",
    "transdate",
    "valuedate",
  ],
  time: ["time", "transactiontime"],
  amount: ["amount", "amt", "transactionamount", "value"],
  type: ["type", "transactiontype", "debitcredit", "drcr", "creditdebit"],
  moneyIn: [
    "credit",
    "credits",
    "moneyin",
    "deposit",
    "deposits",
    "paidin",
    "creditamount",
  ],
  moneyOut: [
    "debit",
    "debits",
    "moneyout",
    "withdrawal",
    "withdrawals",
    "paidout",
    "debitamount",
  ],
  category: ["category"],
  subcategory: ["subcategory"],
  payee: ["payee", "merchant", "description", "name", "counterparty"],
  note: ["note", "notes", "memo", "reference", "details", "narrative"],
  status: ["status"],
  tags: ["tags", "tag", "labels"],
  id: ["id"],
  splitLine: ["line"],
} as const;

/** Looks for the first column whose header matches one of the names. */
function find(headers: string[], names: readonly string[]): number | null {
  const keys = headers.map(normal);
  for (const name of names) {
    const at = keys.indexOf(name);
    if (at >= 0) return at;
  }
  return null;
}

export function emptyMapping(hasHeader: boolean): ImportMapping {
  return {
    hasHeader,
    date: null,
    dateFormat: "iso",
    time: null,
    amountStyle: "signed",
    amount: null,
    type: null,
    moneyIn: null,
    moneyOut: null,
    positiveIsSpending: false,
    decimal: "dot",
    category: null,
    subcategory: null,
    payee: null,
    note: null,
    status: null,
    tags: null,
    id: null,
    splitLine: null,
  };
}

const DATE_PREFIX = /^\s*(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})/;
/** ISO when a value starts with a four-digit year; otherwise the part above 12 decides, else month first. */
export function detectDateFormat(values: string[]): DateFormat {
  let first = false;
  let second = false;
  for (const value of values) {
    const match = DATE_PREFIX.exec(value);
    if (!match) continue;
    if ((match[1] as string).length === 4) return "iso";
    if (Number(match[1]) > 12) first = true;
    if (Number(match[2]) > 12) second = true;
  }
  return first && !second ? "dmy" : "mdy";
}

/** "1.234,56" style when the last separator in a value is a comma followed by one or two digits. */
export function detectDecimal(values: string[]): DecimalStyle {
  let comma = 0;
  let dot = 0;
  for (const value of values) {
    const last = Math.max(value.lastIndexOf(","), value.lastIndexOf("."));
    if (last < 0) continue;
    const after = value.slice(last + 1).replace(/\D.*$/, "");
    if (after.length === 3 && !value.includes(value[last] === "," ? "." : ","))
      continue;
    if (value[last] === "," && after.length >= 1 && after.length <= 2) comma++;
    if (value[last] === "." && after.length >= 1 && after.length <= 2) dot++;
  }
  return comma > dot ? "comma" : "dot";
}

const column = (rows: string[][], at: number | null) =>
  at === null ? [] : rows.map((row) => row[at] ?? "");

/** A first guess from the header names and a look at the values; the owner can change every part. */
export function guessMapping(table: string[][]): ImportMapping {
  const headers = table[0] ?? [];
  const body = table.slice(1);
  const looksLikeHeader =
    headers.some((cell) => /[a-z]/i.test(cell)) &&
    !headers.some((cell) => /^\s*[-+(]?[\d.,]+\)?\s*$/.test(cell));
  const mapping = emptyMapping(looksLikeHeader);
  if (!looksLikeHeader) return mapping;
  for (const key of [
    "date",
    "time",
    "amount",
    "type",
    "moneyIn",
    "moneyOut",
    "category",
    "subcategory",
    "payee",
    "note",
    "status",
    "tags",
    "id",
    "splitLine",
  ] as const)
    mapping[key] = find(headers, NAMES[key]);
  mapping.amountStyle =
    mapping.amount !== null && mapping.type !== null
      ? "typed"
      : mapping.amount === null &&
          mapping.moneyIn !== null &&
          mapping.moneyOut !== null
        ? "split"
        : "signed";
  mapping.dateFormat = detectDateFormat(column(body, mapping.date));
  mapping.decimal = detectDecimal([
    ...column(body, mapping.amount),
    ...column(body, mapping.moneyIn),
    ...column(body, mapping.moneyOut),
  ]);
  return mapping;
}

/** The mapping with one column chosen; the date format or number style is read again from that column's values. */
export function withColumn(
  table: string[][],
  mapping: ImportMapping,
  name:
    | "date"
    | "time"
    | "amount"
    | "type"
    | "moneyIn"
    | "moneyOut"
    | "category"
    | "subcategory"
    | "payee"
    | "note"
    | "status"
    | "tags",
  at: number | null,
): ImportMapping {
  const next = { ...mapping, [name]: at };
  const body = table.slice(mapping.hasHeader ? 1 : 0);
  if (name === "date" && at !== null)
    next.dateFormat = detectDateFormat(column(body, at));
  if (
    (name === "amount" || name === "moneyIn" || name === "moneyOut") &&
    at !== null
  )
    next.decimal = detectDecimal([
      ...column(body, next.amount),
      ...column(body, next.moneyIn),
      ...column(body, next.moneyOut),
    ]);
  return next;
}

/** Whether the mapping has what it needs to read a row. */
export function mappingProblem(mapping: ImportMapping): string | null {
  if (mapping.date === null) return "Choose the date column.";
  if (mapping.amountStyle === "split") {
    if (mapping.moneyIn === null || mapping.moneyOut === null)
      return "Choose the money in and money out columns.";
  } else if (mapping.amount === null) return "Choose the amount column.";
  if (mapping.amountStyle === "typed" && mapping.type === null)
    return "Choose the column that says income or expense.";
  return null;
}

const STORE = "ledgerline.import.mapping.v1:";
const signature = (headers: string[]) => headers.map(normal).join("|");
/** Remembers a mapping on this device for files with the same column headers. */
export function saveMapping(headers: string[], mapping: ImportMapping) {
  try {
    localStorage.setItem(STORE + signature(headers), JSON.stringify(mapping));
  } catch {
    // Storage can be unavailable; the mapping just is not remembered.
  }
}
export function savedMapping(
  headers: string[],
  columnCount: number,
): ImportMapping | null {
  try {
    const text = localStorage.getItem(STORE + signature(headers));
    if (!text) return null;
    const parsed = JSON.parse(text) as ImportMapping;
    const indexes = [
      parsed.date,
      parsed.time,
      parsed.amount,
      parsed.type,
      parsed.moneyIn,
      parsed.moneyOut,
      parsed.category,
      parsed.subcategory,
      parsed.payee,
      parsed.note,
      parsed.status,
      parsed.tags ?? null,
      parsed.id,
      parsed.splitLine,
    ];
    return indexes.every(
      (at) =>
        at === null || (Number.isInteger(at) && at >= 0 && at < columnCount),
    )
      ? { ...emptyMapping(true), ...parsed }
      : null;
  } catch {
    return null;
  }
}
