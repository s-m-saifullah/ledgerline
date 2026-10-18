import { saveBlob } from "../../lib/download";

export const TEMPLATE_NAME = "ledgerline-import-template.csv";

/** A small file to fill in: the columns import reads, with two example rows. Made here, never fetched. */
export function templateCsv() {
  const lines = [
    [
      "date",
      "time",
      "type",
      "amount",
      "category",
      "subcategory",
      "payee",
      "note",
      "status",
    ],
    [
      "2026-01-15",
      "",
      "expense",
      "12.50",
      "Food",
      "Groceries",
      "Corner shop",
      "Weekly shop",
      "cleared",
    ],
    [
      "2026-01-16",
      "09:30",
      "income",
      "2500.00",
      "Salary",
      "",
      "Acme Inc",
      "January pay",
      "cleared",
    ],
  ];
  return `﻿${lines.map((cells) => cells.join(",")).join("\r\n")}\r\n`;
}

export function saveTemplate() {
  saveBlob(
    new Blob([templateCsv()], { type: "text/csv;charset=utf-8" }),
    TEMPLATE_NAME,
  );
}
