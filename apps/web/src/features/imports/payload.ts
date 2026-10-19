import type { Category, ImportRow } from "@ledgerline/shared";
import { categoryWording, matchCategory, wordingKey } from "./categories";
import type { FileRow } from "./rows";

/** What the owner chose: a category per unmatched wording, and a default for each direction. */
export type CategoryChoices = {
  byWording: Record<string, string | "default">;
  defaults: { expense: string | null; income: string | null };
};

/** The category a row will use, or null when it still needs a choice. */
export function categoryFor(
  row: FileRow,
  categories: readonly Category[],
  choices: CategoryChoices,
): string | null {
  const wording = categoryWording(row);
  if (wording) {
    const chosen = choices.byWording[wordingKey(row.kind, wording)];
    if (chosen && chosen !== "default") return chosen;
    if (!chosen) {
      const match = matchCategory(row.kind, wording, categories);
      if (match) return match.id;
      return null;
    }
  }
  return choices.defaults[row.kind];
}

/** Rows ready for the API, or the lines still lacking a category. */
export function toImportRows(
  rows: readonly FileRow[],
  categories: readonly Category[],
  choices: CategoryChoices,
) {
  const ready: ImportRow[] = [];
  const unresolved: number[] = [];
  for (const row of rows) {
    const categoryId = categoryFor(row, categories, choices);
    if (!categoryId) {
      unresolved.push(row.line);
      continue;
    }
    ready.push({
      line: row.line,
      date: row.date,
      time: row.time,
      kind: row.kind,
      amount: row.amount,
      categoryId,
      payee: row.payee,
      note: row.note,
      status: row.status,
      tags: row.tags,
      sourceId: row.sourceId,
    });
  }
  return { ready, unresolved };
}
