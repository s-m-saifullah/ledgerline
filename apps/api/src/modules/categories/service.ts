import {
  type ArchiveCategory,
  basicCategoryStarterSet,
  type CategoryListQuery,
  type CreateCategory,
  type CreateCategoryStarterSet,
  categorySchema,
  categoryStarterGroups,
  createCategorySchema,
  type DeleteCategory,
  defaultStarterGroupKeys,
  type JsonValue,
  type ReorderCategories,
  type UnarchiveCategory,
  type UpdateCategory,
} from "@ledgerline/shared";
import type { z } from "zod";
import type { Database, DatabaseTransaction } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { requireLedgerRead } from "../ledgers/service";
import { requireNoActiveTransactions } from "../transactions/reference-service";
import {
  runFinancialWrite,
  type WriteContext,
  type WriteIdentity,
  type WriteResponse,
} from "../writes/service";
import { nextVersion, requireVersionUpdate } from "../writes/version";
import { type CategoryRow, categoryRepository } from "./repo";

const sameId = (a: string | null, b: string | null) =>
  a?.toLowerCase() === b?.toLowerCase();
export function categoryDto(row: CategoryRow) {
  return categorySchema.parse({
    ...row,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
const dto = categoryDto;
function requireCategory(row: CategoryRow | undefined) {
  if (!row) throw new ApiProblem(404, "Not found", "Category not found.");
  return row;
}
function conflict(field: string, message: string): never {
  throw new ApiProblem(409, "Conflict", message, [{ field, message }]);
}
type Repo = ReturnType<typeof categoryRepository>;
async function validateParent(
  repo: Repo,
  kind: string,
  parentId: string | null,
  current?: CategoryRow,
) {
  if (!parentId) return;
  if (current && sameId(current.id, parentId))
    conflict("parentId", "A category cannot be its own parent.");
  const parent = requireCategory(await repo.find(parentId));
  if (parent.kind !== kind)
    conflict("parentId", "The parent must have the same category kind.");
  if (parent.archivedAt)
    conflict("parentId", "Choose an active parent category.");
  if (parent.parentId)
    conflict("parentId", "Categories can have only two levels.");
  // A root with children cannot become a child, even when its children are archived.
  if (
    current &&
    (await repo.all()).some((row) => sameId(row.parentId, current.id))
  )
    conflict(
      "parentId",
      "Move this category's children before assigning a parent.",
    );
}
async function uniqueName(
  repo: Repo,
  kind: string,
  parentId: string | null,
  name: string,
  id?: string,
) {
  if (await repo.duplicate(kind, parentId, name, id))
    conflict(
      "name",
      "A sibling category already has this name, including archived categories.",
    );
}
async function appendOrder(repo: Repo, kind: string, parentId: string | null) {
  const siblings = (await repo.all()).filter(
    (row) => row.kind === kind && sameId(row.parentId, parentId),
  );
  const order = Math.max(-1, ...siblings.map((row) => row.sortOrder)) + 1;
  if (order > 2_147_483_647)
    conflict(
      "sortOrder",
      "Reorder the sibling categories before adding another.",
    );
  return order;
}
function write(
  db: Database,
  identity: WriteIdentity,
  operation: string,
  request: JsonValue,
  mutate: (repo: Repo, context: WriteContext) => Promise<WriteResponse>,
) {
  return runFinancialWrite(
    db,
    { ...identity, operation, request },
    async (context) => {
      const repo = categoryRepository(context.tx, context.ledgerId);
      await repo.lock();
      return mutate(repo, context);
    },
  );
}
export async function listCategories(
  db: Database,
  actorId: string,
  ledgerId: string,
  query: CategoryListQuery,
) {
  await requireLedgerRead(db, actorId, ledgerId);
  const rows = await categoryRepository(db, ledgerId).list(query);
  const page = rows.slice(0, query.limit);
  return {
    items: page.map(dto),
    nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
  };
}
export async function getCategory(
  db: Database,
  actorId: string,
  ledgerId: string,
  id: string,
) {
  await requireLedgerRead(db, actorId, ledgerId);
  return dto(requireCategory(await categoryRepository(db, ledgerId).find(id)));
}
export function createCategory(
  db: Database,
  identity: WriteIdentity,
  body: CreateCategory,
) {
  return write(db, identity, "POST categories", body, async (repo) => {
    await validateParent(repo, body.kind, body.parentId);
    await uniqueName(repo, body.kind, body.parentId, body.name);
    return {
      status: 201,
      body: dto(
        requireCategory(
          await repo.create(
            body,
            await appendOrder(repo, body.kind, body.parentId),
          ),
        ),
      ),
    };
  });
}
export function updateCategory(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: UpdateCategory,
) {
  const { expectedVersion, ...input } = body;
  // Optional fields omitted by Zod must not enter the canonical JSON fingerprint.
  const changes = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
  return write(
    db,
    identity,
    `PATCH categories/${id.toLowerCase()}`,
    { expectedVersion, ...changes },
    async (repo) => {
      const current = requireCategory(await repo.find(id));
      const version = nextVersion(current.version, expectedVersion);
      const parentId =
        body.parentId === undefined ? current.parentId : body.parentId;
      if (!sameId(parentId, current.parentId))
        await validateParent(repo, current.kind, parentId, current);
      await uniqueName(
        repo,
        current.kind,
        parentId,
        body.name ?? current.name,
        id,
      );
      const sortOrder = sameId(parentId, current.parentId)
        ? current.sortOrder
        : await appendOrder(repo, current.kind, parentId);
      return {
        status: 200,
        body: dto(
          requireVersionUpdate(
            await repo.update(
              id,
              expectedVersion,
              { ...changes, sortOrder },
              version,
            ),
          ),
        ),
      };
    },
  );
}
export function archiveCategory(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: ArchiveCategory,
) {
  return write(
    db,
    identity,
    `POST categories/${id.toLowerCase()}/archive`,
    body,
    async (repo) => {
      const current = requireCategory(await repo.find(id));
      const version = nextVersion(current.version, body.expectedVersion);
      if (current.archivedAt)
        conflict("expectedVersion", "This category is already archived.");
      if (
        (await repo.all()).some(
          (row) => sameId(row.parentId, id) && !row.archivedAt,
        )
      )
        conflict(
          "parentId",
          "Archive active children before archiving their parent.",
        );
      return {
        status: 200,
        body: dto(
          requireVersionUpdate(
            await repo.update(
              id,
              body.expectedVersion,
              { archivedAt: new Date() },
              version,
            ),
          ),
        ),
      };
    },
  );
}
export function unarchiveCategory(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: UnarchiveCategory,
) {
  return write(
    db,
    identity,
    `POST categories/${id.toLowerCase()}/unarchive`,
    body,
    async (repo) => {
      const current = requireCategory(await repo.find(id));
      const version = nextVersion(current.version, body.expectedVersion);
      if (!current.archivedAt)
        conflict("expectedVersion", "This category is already active.");
      await validateParent(repo, current.kind, current.parentId, current);
      return {
        status: 200,
        body: dto(
          requireVersionUpdate(
            await repo.update(
              id,
              body.expectedVersion,
              {
                archivedAt: null,
                sortOrder: await appendOrder(
                  repo,
                  current.kind,
                  current.parentId,
                ),
              },
              version,
            ),
          ),
        ),
      };
    },
  );
}
export function reorderCategories(
  db: Database,
  identity: WriteIdentity,
  body: ReorderCategories,
) {
  return write(db, identity, "POST categories/reorder", body, async (repo) => {
    await validateParent(repo, body.kind, body.parentId);
    const siblings = (await repo.all()).filter(
      (row) =>
        row.kind === body.kind &&
        sameId(row.parentId, body.parentId) &&
        !row.archivedAt,
    );
    // Resolve targets first so cross-ledger/tombstoned IDs remain indistinguishable.
    const targets: CategoryRow[] = [];
    for (const item of body.items)
      targets.push(requireCategory(await repo.find(item.id)));
    if (
      siblings.length !== targets.length ||
      targets.some((row) => !siblings.some((sibling) => sibling.id === row.id))
    )
      conflict(
        "items",
        "Provide every active sibling in this group exactly once.",
      );
    const edits = targets.map((row, index) => {
      const input = body.items[index];
      if (!input) throw new Error("Missing reorder input");
      return {
        row,
        expectedVersion: input.expectedVersion,
        version: nextVersion(row.version, input.expectedVersion),
      };
    });
    const items = [];
    for (const [index, { row, expectedVersion, version }] of edits.entries())
      items.push(
        dto(
          requireVersionUpdate(
            await repo.update(
              row.id,
              expectedVersion,
              { sortOrder: index },
              version,
            ),
          ),
        ),
      );
    return { status: 200, body: { items } };
  });
}
export function createCategoryStarterSet(
  db: Database,
  identity: WriteIdentity,
  body: CreateCategoryStarterSet,
) {
  return write(
    db,
    identity,
    "POST categories/starter-set",
    // Omitted optional fields must not enter the canonical JSON fingerprint.
    {
      starterSet: body.starterSet,
      ...(body.groups ? { groups: body.groups } : {}),
    },
    async (repo) => {
      if ((await repo.all()).length)
        conflict(
          "starterSet",
          "The starter set requires an empty category list, including archived categories.",
        );
      const items: ReturnType<typeof dto>[] = [];
      const create = async (input: z.input<typeof createCategorySchema>) => {
        const category = createCategorySchema.parse(input);
        const row = requireCategory(
          await repo.create(
            category,
            await appendOrder(repo, category.kind, category.parentId),
          ),
        );
        items.push(dto(row));
        return row;
      };
      if (body.starterSet === "basic")
        for (const input of basicCategoryStarterSet) await create(input);
      else {
        const chosen = new Set<string>(body.groups ?? defaultStarterGroupKeys);
        for (const group of categoryStarterGroups) {
          if (!chosen.has(group.key)) continue;
          const parent = await create({
            name: group.name,
            kind: group.kind,
            icon: group.icon,
            color: group.color,
          });
          for (const name of group.children)
            await create({
              name,
              kind: group.kind,
              parentId: parent.id,
              icon: group.icon,
              color: group.color,
            });
        }
      }
      return { status: 201, body: { items } };
    },
  );
}

/** Share the category mutation lock so archive/reparent cannot race a new assignment. */
export async function lockTransactionCategories(
  tx: DatabaseTransaction,
  ledgerId: string,
) {
  await categoryRepository(tx, ledgerId).lock();
}
export async function validateTransactionCategory(
  tx: DatabaseTransaction,
  ledgerId: string,
  id: string,
  kind: string,
  newAssignment: boolean,
) {
  const row = requireCategory(await categoryRepository(tx, ledgerId).find(id));
  if (row.kind !== kind)
    conflict("categoryId", "Choose a category matching the transaction kind.");
  if (newAssignment && row.archivedAt)
    conflict("categoryId", "Choose an active category.");
}

export function deleteCategory(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: DeleteCategory,
) {
  return write(
    db,
    identity,
    `DELETE categories/${id.toLowerCase()}`,
    body,
    async (repo, { tx, ledgerId }) => {
      const current = requireCategory(await repo.find(id));
      const version = nextVersion(current.version, body.expectedVersion);
      if ((await repo.all()).some((row) => sameId(row.parentId, id)))
        conflict(
          "parentId",
          "Delete or move the child categories first, including archived children.",
        );
      await requireNoActiveTransactions(tx, ledgerId, "categoryId", id);
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
