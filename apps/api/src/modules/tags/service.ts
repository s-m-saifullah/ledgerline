import {
  type ArchiveTag,
  type CreateTag,
  type JsonValue,
  type TagListQuery,
  type TagRef,
  tagSchema,
  type UpdateTag,
} from "@ledgerline/shared";
import type { Database, DatabaseConnection } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { lockTransactionCategories } from "../categories/service";
import { requireLedgerRead } from "../ledgers/service";
import { detachUnusedTag, tagUsage } from "../transactions/tag-service";
import {
  runFinancialWrite,
  type WriteContext,
  type WriteIdentity,
  type WriteResponse,
} from "../writes/service";
import { nextVersion, requireVersionUpdate } from "../writes/version";
import { type TagRow, tagRepository } from "./repo";

function dto(row: TagRow, usageCount: number) {
  return tagSchema.parse({
    ...row,
    usageCount,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
async function dtoOf(db: DatabaseConnection, ledgerId: string, row: TagRow) {
  return dto(row, (await tagUsage(db, ledgerId, [row.id])).get(row.id) ?? 0);
}
function required(row: TagRow | undefined) {
  if (!row) throw new ApiProblem(404, "Not found", "Tag not found.");
  return row;
}
async function uniqueName(
  repo: ReturnType<typeof tagRepository>,
  name: string,
  id?: string,
) {
  if (await repo.byName(name, id))
    throw new ApiProblem(
      409,
      "Conflict",
      "A tag with this name already exists, including archived tags.",
      [{ field: "name", message: "Choose a name no other tag uses." }],
    );
}
function write(
  db: Database,
  identity: WriteIdentity,
  operation: string,
  request: JsonValue,
  mutate: (
    repo: ReturnType<typeof tagRepository>,
    context: WriteContext,
  ) => Promise<WriteResponse>,
) {
  return runFinancialWrite(
    db,
    { ...identity, operation, request },
    async (context) => {
      // The same ledger lock entry writes take, so assigning and deleting a tag never interleave.
      await lockTransactionCategories(context.tx, context.ledgerId);
      return mutate(tagRepository(context.tx, context.ledgerId), context);
    },
  );
}
export async function listTags(
  db: Database,
  actorId: string,
  ledgerId: string,
  query: TagListQuery,
) {
  await requireLedgerRead(db, actorId, ledgerId);
  const rows = await tagRepository(db, ledgerId).list(query);
  const page = rows.slice(0, query.limit);
  const usage = await tagUsage(
    db,
    ledgerId,
    page.map((row) => row.id),
  );
  return {
    items: page.map((row) => dto(row, usage.get(row.id) ?? 0)),
    nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
  };
}
export async function getTag(
  db: Database,
  actorId: string,
  ledgerId: string,
  id: string,
) {
  await requireLedgerRead(db, actorId, ledgerId);
  return dtoOf(
    db,
    ledgerId,
    required(await tagRepository(db, ledgerId).find(id)),
  );
}
export function createTag(
  db: Database,
  identity: WriteIdentity,
  body: CreateTag,
) {
  return write(db, identity, "POST tags", body, async (repo, context) => {
    await uniqueName(repo, body.name);
    return {
      status: 201,
      body: await dtoOf(
        context.tx,
        context.ledgerId,
        required(await repo.create(body.name)),
      ),
    };
  });
}
export function updateTag(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: UpdateTag,
) {
  return write(
    db,
    identity,
    `PATCH tags/${id.toLowerCase()}`,
    body,
    async (repo, context) => {
      const current = required(await repo.find(id));
      const version = nextVersion(current.version, body.expectedVersion);
      await uniqueName(repo, body.name, id);
      return {
        status: 200,
        body: await dtoOf(
          context.tx,
          context.ledgerId,
          requireVersionUpdate(
            await repo.update(
              id,
              body.expectedVersion,
              { name: body.name },
              version,
            ),
          ),
        ),
      };
    },
  );
}
function archiveChange(archive: boolean) {
  return (
    db: Database,
    identity: WriteIdentity,
    id: string,
    body: ArchiveTag,
  ) =>
    write(
      db,
      identity,
      `POST tags/${id.toLowerCase()}/${archive ? "archive" : "unarchive"}`,
      body,
      async (repo, context) => {
        const current = required(await repo.find(id));
        const version = nextVersion(current.version, body.expectedVersion);
        if (!!current.archivedAt === archive)
          throw new ApiProblem(
            409,
            "Conflict",
            archive
              ? "This tag is already archived."
              : "This tag is already active.",
          );
        return {
          status: 200,
          body: await dtoOf(
            context.tx,
            context.ledgerId,
            requireVersionUpdate(
              await repo.update(
                id,
                body.expectedVersion,
                { archivedAt: archive ? new Date() : null },
                version,
              ),
            ),
          ),
        };
      },
    );
}
export const archiveTag = archiveChange(true);
export const unarchiveTag = archiveChange(false);
export function deleteTag(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: ArchiveTag,
) {
  return write(
    db,
    identity,
    `DELETE tags/${id.toLowerCase()}`,
    body,
    async (repo, context) => {
      const current = required(await repo.find(id));
      const version = nextVersion(current.version, body.expectedVersion);
      await detachUnusedTag(context.tx, context.ledgerId, id);
      requireVersionUpdate(
        await repo.update(
          id,
          body.expectedVersion,
          { deletedAt: new Date() },
          version,
        ),
      );
      return { status: 204, body: null };
    },
  );
}
/** Entries may carry archived tags (archiving only hides a tag from pickers) but not deleted or foreign ones. */
export async function requireTags(
  db: DatabaseConnection,
  ledgerId: string,
  ids: string[],
) {
  const found = await tagRepository(db, ledgerId).byIds(ids);
  const missing = ids.filter(
    (id) => !found.some((row) => row.id === id.toLowerCase()),
  );
  if (missing.length)
    throw new ApiProblem(404, "Not found", "Tag not found.", [
      { field: "tagIds", message: "Choose tags that exist." },
    ]);
}
/** Id to what an entry shows of a tag. */
export async function tagRefs(
  db: DatabaseConnection,
  ledgerId: string,
  ids: string[],
) {
  const rows = await tagRepository(db, ledgerId).byIds([...new Set(ids)]);
  return new Map<string, TagRef>(
    rows.map((row) => [
      row.id,
      { id: row.id, name: row.name, archived: !!row.archivedAt },
    ]),
  );
}
/** The comparison key of a tag name: tags are the same when this is. */
export const tagKey = (name: string) => name.trim().toLowerCase();
/** Which of these names (by key) already belong to a live tag, archived ones included. */
export async function existingTagKeys(
  db: DatabaseConnection,
  ledgerId: string,
  names: string[],
) {
  const rows = await tagRepository(db, ledgerId).byNames([
    ...new Set(names.map(tagKey)),
  ]);
  return new Set(rows.map((row) => tagKey(row.name)));
}
/** Finds each tag by name (ignoring case) or creates it; returns key to id and how many were new. */
export async function ensureTagsByName(
  tx: DatabaseConnection,
  ledgerId: string,
  names: string[],
) {
  const repo = tagRepository(tx, ledgerId);
  const keys = [...new Set(names.map(tagKey))];
  const ids = new Map(
    (await repo.byNames(keys)).map((row) => [tagKey(row.name), row.id]),
  );
  let created = 0;
  for (const name of names) {
    const key = tagKey(name);
    if (ids.has(key)) continue;
    const row = required(await repo.create(name.trim()));
    ids.set(key, row.id);
    created++;
  }
  return { ids, created };
}
