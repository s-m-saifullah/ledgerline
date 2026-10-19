import type { TagRef } from "@ledgerline/shared";
import type { DatabaseConnection } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { lockTransactionCategories } from "../categories/service";
import { ensureTagsByName, requireTags, tagRefs } from "../tags/service";
import { tagLinkRepository } from "./tag-link-repo";

/** The tags on each of these entries, by entry id (ADR 0035). */
export async function entryTags(
  db: DatabaseConnection,
  ledgerId: string,
  entryIds: string[],
) {
  const links = await tagLinkRepository(db, ledgerId).forEntries(entryIds);
  const refs = await tagRefs(db, ledgerId, [...links.values()].flat());
  const byEntry = new Map<string, TagRef[]>();
  for (const [entryId, tagIds] of links)
    byEntry.set(
      entryId,
      tagIds.flatMap((id) => refs.get(id) ?? []),
    );
  return byEntry;
}
/**
 * Put exactly these tags on the entries (a transfer passes both legs). Inside a financial write;
 * takes the same ledger lock as deleting a tag, so a tag cannot vanish under an assignment.
 */
export async function assignTags(
  tx: Parameters<typeof lockTransactionCategories>[0],
  ledgerId: string,
  entryIds: string[],
  tagIds: string[],
) {
  await lockTransactionCategories(tx, ledgerId);
  await requireTags(tx, ledgerId, tagIds);
  await tagLinkRepository(tx, ledgerId).replace(entryIds, tagIds);
}
/** How many live entries carry each tag. */
export const tagUsage = (
  db: DatabaseConnection,
  ledgerId: string,
  tagIds: string[],
) => tagLinkRepository(db, ledgerId).usage(tagIds);
/** A tag that still sits on a live entry cannot be deleted; deleted entries do not count. */
export async function detachUnusedTag(
  db: DatabaseConnection,
  ledgerId: string,
  tagId: string,
) {
  const repo = tagLinkRepository(db, ledgerId);
  if ((await repo.usage([tagId])).get(tagId))
    throw new ApiProblem(
      409,
      "Conflict",
      "Remove this tag from its entries first, or archive it to keep its history.",
    );
  await repo.detach(tagId);
}
/**
 * For an import: find or create the tags the rows name, then put them on the new entries.
 * `entries` pairs each saved entry with its (already checked, distinct) tag names.
 */
export async function attachImportedTags(
  tx: Parameters<typeof lockTransactionCategories>[0],
  ledgerId: string,
  entries: { entryId: string; names: string[] }[],
) {
  const names = entries.flatMap((entry) => entry.names);
  if (!names.length) return 0;
  await lockTransactionCategories(tx, ledgerId);
  const { ids, created } = await ensureTagsByName(tx, ledgerId, names);
  await tagLinkRepository(tx, ledgerId).insertMany(
    entries.flatMap((entry) =>
      entry.names.map((name) => ({
        entryId: entry.entryId,
        tagId: ids.get(name.trim().toLowerCase()) as string,
      })),
    ),
  );
  return created;
}
