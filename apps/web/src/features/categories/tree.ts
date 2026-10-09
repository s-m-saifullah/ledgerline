import type { Category, ReorderCategories } from "@ledgerline/shared";
export const byOrder = (a: Category, b: Category) =>
  a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);
export function siblings(items: readonly Category[], category: Category) {
  return items
    .filter(
      (row) =>
        row.kind === category.kind &&
        row.parentId === category.parentId &&
        !row.archivedAt,
    )
    .sort(byOrder);
}
export function moveCategory(
  items: readonly Category[],
  category: Category,
  direction: -1 | 1,
): ReorderCategories | null {
  const group = siblings(items, category);
  const index = group.findIndex((row) => row.id === category.id);
  const next = index + direction;
  const neighbor = group[next];
  if (index < 0 || !neighbor || group.length > 1000) return null;
  group[index] = neighbor;
  group[next] = category;
  return {
    kind: category.kind,
    parentId: category.parentId,
    items: group.map((row) => ({ id: row.id, expectedVersion: row.version })),
  };
}
export function categoryOptions(
  items: readonly Category[],
  kind: Category["kind"],
  search: string,
  rootsOnly = false,
  excludeId?: string,
) {
  const roots = items
    .filter((row) => row.kind === kind && !row.parentId)
    .sort(byOrder);
  const term = search.trim().toLocaleLowerCase();
  const options: { category: Category; label: string }[] = [];
  for (const root of roots) {
    const group = rootsOnly
      ? [root]
      : [
          root,
          ...items.filter((row) => row.parentId === root.id).sort(byOrder),
        ];
    for (const category of group) {
      if (category.archivedAt || root.archivedAt || category.id === excludeId)
        continue;
      const label = category.parentId
        ? `${root.name} / ${category.name}`
        : category.name;
      if (label.toLocaleLowerCase().includes(term))
        options.push({ category, label });
    }
  }
  return options;
}
