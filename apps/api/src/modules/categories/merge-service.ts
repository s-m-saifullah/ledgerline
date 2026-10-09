import { createHash } from "node:crypto";
import {
  type CategoryMerge,
  categoryMergePreviewSchema,
  categoryMergeResultSchema,
} from "@ledgerline/shared";
import type { Database, DatabaseTransaction } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { requireLedgerRead } from "../ledgers/service";
import {
  categoryMergePayments,
  mergeLinkedPaymentCategories,
} from "../receivables/service";
import {
  categoryMergeReferences,
  mergeUnlinkedCategoryReferences,
} from "../transactions/category-merge-service";
import { runFinancialWrite, type WriteIdentity } from "../writes/service";
import { nextVersion, requireVersionUpdate } from "../writes/version";
import { categoryRepository } from "./repo";
import { categoryDto } from "./service";

const MAX_VERSION = 2_147_483_647;
const stale = () =>
  new ApiProblem(
    409,
    "Conflict",
    "The merge preview changed. Reload it and confirm again.",
    [
      {
        field: "previewToken",
        message: "Review a fresh preview before merging.",
      },
    ],
  );

/** All discovery runs after the category ledger lock; unrelated rows are excluded from the digest. */
async function state(
  tx: DatabaseTransaction,
  actorId: string,
  ledgerId: string,
  sourceId: string,
  destinationId: string,
) {
  const repo = categoryRepository(tx, ledgerId),
    rows = await repo.mergeRows();
  const source = rows.find((row) => row.id === sourceId && !row.deletedAt),
    destination = rows.find(
      (row) => row.id === destinationId && !row.deletedAt,
    );
  if (!source || !destination)
    throw new ApiProblem(404, "Not found", "Category not found.");
  const children = source.parentId
    ? []
    : rows
        .filter((row) => row.parentId === source.id && !row.deletedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const siblings = destination.parentId
    ? []
    : rows.filter((row) => row.parentId === destination.id && !row.deletedAt);
  const deletedChildren = source.parentId
    ? []
    : rows.filter((row) => row.parentId === source.id && row.deletedAt);
  const parents = rows.filter(
    (row) => row.id === source.parentId || row.id === destination.parentId,
  );
  const refs = await categoryMergeReferences(tx, ledgerId, sourceId);
  const payments = await categoryMergePayments(tx, ledgerId, refs.linked);
  const blockers: { code: string; message: string }[] = [];
  if (source.id === destination.id)
    blockers.push({
      code: "sameCategory",
      message: "Choose a different destination category.",
    });
  if (source.kind !== destination.kind)
    blockers.push({
      code: "differentKind",
      message: "Choose a destination with the same income or expense kind.",
    });
  if (!!source.parentId !== !!destination.parentId)
    blockers.push({
      code: "differentLevel",
      message: "Merge roots with roots, or children with children.",
    });
  if (destination.archivedAt)
    blockers.push({
      code: "archivedDestination",
      message: "Choose an active destination category.",
    });
  if (
    destination.parentId &&
    !parents.some(
      (row) =>
        row.id === destination.parentId &&
        !row.deletedAt &&
        !row.archivedAt &&
        !row.parentId &&
        row.kind === destination.kind,
    )
  )
    blockers.push({
      code: "inactiveParent",
      message: "The destination needs an active root parent.",
    });
  for (const child of children)
    if (siblings.some((row) => row.normalizedName === child.normalizedName))
      blockers.push({
        code: "childNameConflict",
        message: `Resolve the child name “${child.name}” before merging, including archived categories.`,
      });
  const firstOrder =
    siblings.reduce((maximum, row) => Math.max(maximum, row.sortOrder), -1) + 1;
  if (children.length && firstOrder + children.length - 1 > MAX_VERSION)
    blockers.push({
      code: "orderLimit",
      message: "Reorder the destination's children before merging.",
    });
  if (
    [
      source,
      destination,
      ...children,
      ...refs.ordinary,
      ...refs.parents,
      ...refs.linked,
    ].some((row) => row.version === MAX_VERSION) ||
    payments.services.some(
      (row) =>
        row.version +
          payments.payments.filter((payment) => payment.receivableId === row.id)
            .length >
        MAX_VERSION,
    )
  )
    blockers.push({
      code: "versionLimit",
      message: "A record has reached its version limit and cannot be merged.",
    });
  const summary = {
    ordinaryCleared: refs.ordinary.filter((row) => row.status === "cleared")
      .length,
    ordinaryPending: refs.ordinary.filter((row) => row.status === "pending")
      .length,
    splitLines: refs.lines.filter((row) => row.categoryId === sourceId).length,
    splitParents: refs.parents.length,
    linkedPayments: refs.linked.length,
    receivables: payments.services.length,
    children: children.map(categoryDto),
    excludedTransactions: refs.excludedTransactions.length,
    excludedSplitLines: refs.excludedLines.length,
    excludedPayments: refs.excludedTransactions.filter(
      (row) => row.receivablePaymentId,
    ).length,
    excludedChildren: deletedChildren.length,
  };
  const previewToken = blockers.length
    ? null
    : createHash("sha256")
        .update(
          JSON.stringify({
            revision: 1,
            actorId: actorId.toLowerCase(),
            ledgerId,
            source,
            destination,
            parents,
            children,
            siblings,
            deletedChildren,
            refs,
            payments,
            summary,
          }),
        )
        .digest("hex");
  return {
    source,
    destination,
    children,
    firstOrder,
    refs,
    payments,
    preview: categoryMergePreviewSchema.parse({
      source: categoryDto(source),
      destination: categoryDto(destination),
      canMerge: blockers.length === 0,
      blockers,
      summary,
      expectedSourceVersion: source.version,
      expectedDestinationVersion: destination.version,
      previewToken,
    }),
  };
}

export function previewCategoryMerge(
  db: Database,
  actorId: string,
  ledgerId: string,
  sourceId: string,
  destinationId: string,
) {
  ledgerId = ledgerId.toLowerCase();
  sourceId = sourceId.toLowerCase();
  destinationId = destinationId.toLowerCase();
  return db.transaction(async (tx) => {
    await requireLedgerRead(tx, actorId, ledgerId);
    await categoryRepository(tx, ledgerId).lock();
    return (await state(tx, actorId, ledgerId, sourceId, destinationId))
      .preview;
  });
}

export function mergeCategories(
  db: Database,
  identity: WriteIdentity,
  sourceId: string,
  body: CategoryMerge,
) {
  sourceId = sourceId.toLowerCase();
  const destinationId = body.destinationCategoryId.toLowerCase(),
    ledgerId = identity.ledgerId.toLowerCase();
  return runFinancialWrite(
    db,
    {
      ...identity,
      ledgerId,
      operation: `POST categories/${sourceId}/merge`,
      request: body,
    },
    async (c) => {
      const repo = categoryRepository(c.tx, ledgerId);
      await repo.lock();
      const current = await state(
        c.tx,
        identity.actorId,
        ledgerId,
        sourceId,
        destinationId,
      );
      if (!current.preview.canMerge)
        throw new ApiProblem(
          409,
          "Conflict",
          current.preview.blockers.map((row) => row.message).join(" "),
          [
            {
              field: "destinationCategoryId",
              message: "Resolve the preview's blocking reasons before merging.",
            },
          ],
        );
      if (current.preview.previewToken !== body.previewToken) throw stale();
      const sourceVersion = nextVersion(
          current.source.version,
          body.expectedSourceVersion,
        ),
        destinationVersion = nextVersion(
          current.destination.version,
          body.expectedDestinationVersion,
        );
      await repo.lockRows([
        sourceId,
        destinationId,
        ...current.children.map((row) => row.id),
      ]);
      await mergeLinkedPaymentCategories(
        c,
        sourceId,
        destinationId,
        current.payments,
      );
      await mergeUnlinkedCategoryReferences(
        c,
        sourceId,
        destinationId,
        current.refs,
      );
      const children = [];
      for (const [index, child] of current.children.entries())
        children.push(
          categoryDto(
            requireVersionUpdate(
              await repo.update(
                child.id,
                child.version,
                {
                  parentId: destinationId,
                  sortOrder: current.firstOrder + index,
                },
                nextVersion(child.version, child.version),
              ),
            ),
          ),
        );
      const source = requireVersionUpdate(
        await repo.update(
          sourceId,
          body.expectedSourceVersion,
          { archivedAt: current.source.archivedAt ?? new Date() },
          sourceVersion,
        ),
      );
      const destination = requireVersionUpdate(
        await repo.update(
          destinationId,
          body.expectedDestinationVersion,
          {},
          destinationVersion,
        ),
      );
      return {
        status: 200,
        body: categoryMergeResultSchema.parse({
          source: categoryDto(source),
          destination: categoryDto(destination),
          summary: { ...current.preview.summary, children },
        }),
      };
    },
  );
}
