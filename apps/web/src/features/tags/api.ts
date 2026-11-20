import { type Tag, tagSchema } from "@ledgerline/shared";
import { prepareFinancialWrite } from "../../lib/api";

const path = (ledgerId: string) => `/ledgers/${ledgerId}/tags`;
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
