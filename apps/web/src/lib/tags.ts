import { type Tag, tagListSchema, tagSchema } from "@ledgerline/shared";
import { api, prepareFinancialWrite } from "./api";

const path = (ledgerId: string) => `/ledgers/${ledgerId}/tags`;
/** Every tag of the ledger, archived ones included, most used first for pickers. */
export async function getTags(
  ledgerId: string,
  signal?: AbortSignal,
): Promise<Tag[]> {
  const items: Tag[] = [];
  const visited = new Set<string>();
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ status: "all", limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const page = tagListSchema.parse(
      await api(`${path(ledgerId)}?${query}`, {
        ...(signal ? { signal } : {}),
      }),
    );
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && visited.has(cursor))
      throw new Error("Tag pagination did not advance");
    if (cursor) visited.add(cursor);
  } while (cursor);
  return items;
}

export function prepareTagCreate(ledgerId: string, name: string) {
  const run = prepareFinancialWrite<unknown>(path(ledgerId), "POST", { name });
  return async () => tagSchema.parse(await run());
}
