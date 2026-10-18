/**
 * Splits CSV text into rows of cells: RFC 4180 quoting, CRLF or LF, a leading byte-order mark
 * ignored. The delimiter is a comma unless told otherwise (some banks use a semicolon or tab).
 */
export function parseCsv(input: string, delimiter = ","): string[][] {
  const text = input.startsWith("﻿") ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let pending = false;
  const endCell = () => {
    row.push(cell);
    cell = "";
    pending = false;
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") {
      quoted = true;
      pending = true;
    } else if (char === delimiter) {
      endCell();
      pending = true;
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      cell += char;
      pending = true;
    }
  }
  if (quoted) throw new Error("A quoted cell is not closed.");
  if (pending || cell !== "" || row.length > 0) endRow();
  return rows;
}

/** The delimiter a file uses: whichever of comma, semicolon and tab is commonest in its first line outside quotes. */
export function detectDelimiter(input: string): string {
  const text = input.startsWith("\uFEFF") ? input.slice(1) : input;
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "\n" || char === "\r")) break;
    else if (!quoted && char in counts) counts[char] = (counts[char] ?? 0) + 1;
  }
  const [best, count] = Object.entries(counts).sort(
    (x, y) => y[1] - x[1],
  )[0] as [string, number];
  return count === 0 ? "," : best;
}

/** Undoes the apostrophe an export puts in front of text that could run as a spreadsheet formula. */
export function unguardText(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}
