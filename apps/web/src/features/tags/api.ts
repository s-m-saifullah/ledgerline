import { type Tag, tagListSchema, tagSchema } from "@ledgerline/shared";
import { api, prepareFinancialWrite } from "../../lib/api";

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
export function prepareTagRename(ledgerId: string, tag: Tag, name: string) {
  const run = prepareFinancialWrite<unknown>(
    `${path(ledgerId)}/${tag.id}`,
    "PATCH",
    { name, expectedVersion: tag.version },
  );
  return async () => tagSchema.parse(await run());
}
export function prepareTagArchive(
  ledgerId: string,
  tag: Tag,
  archive: boolean,
) {
  const run = prepareFinancialWrite<unknown>(
    `${path(ledgerId)}/${tag.id}/${archive ? "archive" : "unarchive"}`,
    "POST",
    { expectedVersion: tag.version },
  );
  return async () => tagSchema.parse(await run());
}
export function prepareTagDelete(ledgerId: string, tag: Tag) {
  return prepareFinancialWrite<void>(`${path(ledgerId)}/${tag.id}`, "DELETE", {
    expectedVersion: tag.version,
  });
}
