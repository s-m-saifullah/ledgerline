import type { Category } from "@ledgerline/shared";
import type { FileRow } from "./rows";

/** The file's wording for a row's category: "Food", or "Food / Groceries" with a subcategory. */
export const categoryWording = (
  row: Pick<FileRow, "category" | "subcategory">,
) => (row.subcategory ? `${row.category} / ${row.subcategory}` : row.category);
export const wordingKey = (kind: FileRow["kind"], wording: string) =>
  `${kind}|${wording.toLocaleLowerCase()}`;

const lower = (text: string) => text.trim().toLocaleLowerCase();

/** The owner's active category with this name and direction: full "Parent / Child" form, a top-level name, or a unique child name. */
export function matchCategory(
  kind: FileRow["kind"],
  wording: string,
  categories: readonly Category[],
): Category | null {
  if (!wording.trim()) return null;
  const byId = new Map(categories.map((c) => [c.id, c]));
  const usable = categories.filter(
    (c) =>
      c.kind === kind &&
      !c.archivedAt &&
      !(c.parentId && byId.get(c.parentId)?.archivedAt),
  );
  const label = (c: Category) =>
    c.parentId ? `${byId.get(c.parentId)?.name ?? ""} / ${c.name}` : c.name;
  const want = lower(wording);
  const full = usable.filter((c) => lower(label(c)) === want);
  if (full.length === 1) return full[0] as Category;
  const named = usable.filter((c) => lower(c.name) === want);
  return named.length === 1 ? (named[0] as Category) : null;
}

/** Every distinct wording in the file, with how many rows use it and the automatic match. */
export function categoryNeeds(
  rows: readonly FileRow[],
  categories: readonly Category[],
) {
  const seen = new Map<
    string,
    {
      kind: FileRow["kind"];
      wording: string;
      rows: number;
      match: Category | null;
    }
  >();
  let blank = { expense: 0, income: 0 };
  for (const row of rows) {
    const wording = categoryWording(row);
    if (!wording) {
      blank = { ...blank, [row.kind]: blank[row.kind] + 1 };
      continue;
    }
    const key = wordingKey(row.kind, wording);
    const found = seen.get(key);
    if (found) found.rows++;
    else
      seen.set(key, {
        kind: row.kind,
        wording,
        rows: 1,
        match: matchCategory(row.kind, wording, categories),
      });
  }
  return {
    wordings: [...seen.entries()].map(([key, value]) => ({ key, ...value })),
    blank,
  };
}
