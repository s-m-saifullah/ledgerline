import {
  type Category,
  type CreateCategory,
  categoryListSchema,
  categorySchema,
} from "@ledgerline/shared";
import { api, prepareFinancialWrite } from "./api";

const path = (ledgerId: string) => `/ledgers/${ledgerId}/categories`;
export async function getCategories(
  ledgerId: string,
  signal?: AbortSignal,
): Promise<Category[]> {
  const items: Category[] = [];
  let cursor: string | null = null;
  const visited = new Set<string>();
  do {
    const query = new URLSearchParams({ status: "all", limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const page = categoryListSchema.parse(
      await api(`${path(ledgerId)}?${query}`, {
        ...(signal ? { signal } : {}),
      }),
    );
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && visited.has(cursor))
      throw new Error("Category pagination did not advance");
    if (cursor) visited.add(cursor);
  } while (cursor);
  return items;
}
export function prepareCategorySave(
  ledgerId: string,
  category: Category | undefined,
  body: CreateCategory,
) {
  const { kind, ...changes } = body;
  const run = prepareFinancialWrite<unknown>(
    category ? `${path(ledgerId)}/${category.id}` : path(ledgerId),
    category ? "PATCH" : "POST",
    category
      ? { ...changes, expectedVersion: category.version }
      : { ...changes, kind },
  );
  return async () => categorySchema.parse(await run());
}
