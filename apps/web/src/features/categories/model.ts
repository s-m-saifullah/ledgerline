import type { Category } from "@ledgerline/shared";
import { byOrder } from "./tree";

/** The chips above the list: everything, the active ones or the archived ones (ADR 0047). */
export type StatusFilter = "all" | "active" | "archived";

export type CategoryGroup = {
  root: Category;
  /** The subcategories that match, in order. */
  children: Category[];
  /** Whether the root itself matches (otherwise it is only the heading of matching children). */
  showRoot: boolean;
};

const inStatus = (row: Category, status: StatusFilter) =>
  status === "all" || (status === "archived") === !!row.archivedAt;
const nameMatches = (row: Category, root: Category, search: string) =>
  `${root.name} ${row.name}`
    .toLocaleLowerCase()
    .includes(search.trim().toLocaleLowerCase());

/** The roots of one kind with their matching subcategories; a root with only matching children still shows. */
export function buildGroups(
  items: readonly Category[],
  kind: Category["kind"],
  status: StatusFilter,
  search: string,
): CategoryGroup[] {
  const matches = (row: Category, root: Category) =>
    inStatus(row, status) && nameMatches(row, root, search);
  return items
    .filter((row) => row.kind === kind && !row.parentId)
    .sort(byOrder)
    .map((root) => ({
      root,
      children: items
        .filter((row) => row.parentId === root.id)
        .sort(byOrder)
        .filter((row) => matches(row, root)),
      showRoot: matches(root, root),
    }))
    .filter((group) => group.showRoot || group.children.length > 0);
}

/** The number beside Expense or Income: main categories not archived. */
export const activeRootCount = (
  items: readonly Category[],
  kind: Category["kind"],
) =>
  items.filter((row) => row.kind === kind && !row.parentId && !row.archivedAt)
    .length;

/** The chip chosen; Active and Archived mean nothing until something is archived, so All stands. */
export const resolveStatus = (
  chosen: StatusFilter | null,
  items: readonly Category[],
): StatusFilter =>
  chosen && (chosen === "all" || anyArchived(items)) ? chosen : "all";

export function anyArchived(items: readonly Category[]) {
  return items.some((row) => row.archivedAt);
}

/** A main category's one hint: archived, or how many subcategories the list shows under it. */
export function groupHint(group: CategoryGroup) {
  if (group.root.archivedAt) return "Archived";
  const count = group.children.length;
  return count === 0
    ? "No subcategories"
    : `${count} ${count === 1 ? "subcategory" : "subcategories"}`;
}

/** Whether Archive may be chosen: not while a parent has active children, and Unarchive not under an archived parent. */
export function archiveBlocked(items: readonly Category[], category: Category) {
  if (category.archivedAt)
    return (
      !!category.parentId &&
      !items.some((row) => row.id === category.parentId && !row.archivedAt)
    );
  return items.some((row) => row.parentId === category.id && !row.archivedAt);
}

/** Whether every group that has subcategories is open (Expand all then says Collapse all). */
export function allOpen(
  groups: readonly CategoryGroup[],
  open: ReadonlySet<string>,
) {
  const withChildren = groups.filter((group) => group.children.length > 0);
  return (
    withChildren.length > 0 &&
    withChildren.every((group) => open.has(group.root.id))
  );
}
