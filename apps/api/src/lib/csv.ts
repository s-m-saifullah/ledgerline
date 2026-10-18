/** Characters that make a spreadsheet read a cell as a formula (ADR 0033). */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Text cell: a leading apostrophe stops a spreadsheet running it as a formula; import removes it. */
export function guardedText(value: string | null | undefined): string {
  if (!value) return "";
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** One RFC 4180 cell: quoted when it holds a comma, quote or line break. */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function csvLine(cells: readonly string[]): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}
