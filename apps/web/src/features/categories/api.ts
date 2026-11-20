import {
  type Category,
  type CategoryMerge,
  categoryBatchSchema,
  categoryMergePreviewSchema,
  categoryMergeResultSchema,
  categorySchema,
  type ReorderCategories,
  type StarterGroupKey,
} from "@ledgerline/shared";
import { api, prepareFinancialWrite } from "../../lib/api";

const path = (ledgerId: string) => `/ledgers/${ledgerId}/categories`;
export async function getCategory(ledgerId: string, id: string) {
  return categorySchema.parse(await api(`${path(ledgerId)}/${id}`));
}
export function prepareCategoryArchive(ledgerId: string, category: Category) {
  const run = prepareFinancialWrite<unknown>(
    `${path(ledgerId)}/${category.id}/archive`,
    "POST",
    { expectedVersion: category.version },
  );
  return async () => categorySchema.parse(await run());
}
export function prepareCategoryUnarchive(ledgerId: string, category: Category) {
  const run = prepareFinancialWrite<unknown>(
    `${path(ledgerId)}/${category.id}/unarchive`,
    "POST",
    { expectedVersion: category.version },
  );
  return async () => categorySchema.parse(await run());
}
export function prepareCategoryReorder(
  ledgerId: string,
  body: ReorderCategories,
) {
  const run = prepareFinancialWrite<unknown>(
    `${path(ledgerId)}/reorder`,
    "POST",
    body,
  );
  return async () => categoryBatchSchema.parse(await run());
}
export function prepareCategoryStarterSet(
  ledgerId: string,
  groups: StarterGroupKey[],
) {
  const run = prepareFinancialWrite<unknown>(
    `${path(ledgerId)}/starter-set`,
    "POST",
    { starterSet: "default", groups },
  );
  return async () => categoryBatchSchema.parse(await run());
}

export function prepareCategoryDelete(ledgerId: string, item: Category) {
  return prepareFinancialWrite<void>(`${path(ledgerId)}/${item.id}`, "DELETE", {
    expectedVersion: item.version,
  });
}

export async function getCategoryMergePreview(
  ledgerId: string,
  sourceId: string,
  destinationCategoryId: string,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ destinationCategoryId });
  return categoryMergePreviewSchema.parse(
    await api(
      `${path(ledgerId)}/${sourceId}/merge-preview?${query}`,
      signal ? { signal } : {},
    ),
  );
}
export function prepareCategoryMerge(
  ledgerId: string,
  sourceId: string,
  body: CategoryMerge,
) {
  const run = prepareFinancialWrite<unknown>(
    `${path(ledgerId)}/${sourceId}/merge`,
    "POST",
    body,
  );
  return async () => categoryMergeResultSchema.parse(await run());
}
