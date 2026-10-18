/** Splits CSV text into rows of cells: RFC 4180 quoting, CRLF or LF, a leading byte-order mark ignored. */
export function parseCsv(input: string): string[][] {
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
    } else if (char === ",") {
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

/** Undoes the apostrophe an export puts in front of text that could run as a spreadsheet formula. */
export function unguardText(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}
