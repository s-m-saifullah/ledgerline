import { describe, expect, it } from "vitest";
import { category } from "../../test-support/category-fixtures";
import {
  activeRootCount,
  allOpen,
  anyArchived,
  archiveBlocked,
  buildGroups,
  groupHint,
  resolveStatus,
} from "./model";

const food = category("Food", { sortOrder: 0 });
const groceries = category("Groceries", { parentId: food.id, sortOrder: 1 });
const dining = category("Dining", { parentId: food.id, sortOrder: 0 });
const rent = category("Rent", { sortOrder: 1 });
const pay = category("Pay", { kind: "income", sortOrder: 0 });
const old = category("Old", {
  sortOrder: 2,
  archivedAt: "2026-10-01T00:00:00.000Z",
});
const all = [food, groceries, dining, rent, pay, old];

describe("buildGroups", () => {
  it("lists the roots of one kind in order, each with its children in order", () => {
    const groups = buildGroups(all, "expense", "all", "");
    expect(groups.map((g) => g.root.name)).toEqual(["Food", "Rent", "Old"]);
    expect(groups[0]?.children.map((c) => c.name)).toEqual([
      "Dining",
      "Groceries",
    ]);
    expect(
      buildGroups(all, "income", "all", "").map((g) => g.root.name),
    ).toEqual(["Pay"]);
  });
  it("filters by status", () => {
    expect(
      buildGroups(all, "expense", "active", "").map((g) => g.root.name),
    ).toEqual(["Food", "Rent"]);
    expect(
      buildGroups(all, "expense", "archived", "").map((g) => g.root.name),
    ).toEqual(["Old"]);
  });
  it("searches the root and child names together, and keeps a root that only has matching children", () => {
    const groups = buildGroups(all, "expense", "all", "groc");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.children.map((c) => c.name)).toEqual(["Groceries"]);
    // The root's name is part of the match, so searching it shows its children too.
    expect(
      buildGroups(all, "expense", "all", " FOOD ")[0]?.children,
    ).toHaveLength(2);
    expect(buildGroups(all, "expense", "all", "zzz")).toEqual([]);
  });
  it("shows a root only as the heading of its matches when the root itself does not match the status", () => {
    const archivedParent = category("Parent", {
      archivedAt: "2026-10-01T00:00:00.000Z",
    });
    const activeChild = category("Kid", { parentId: archivedParent.id });
    const groups = buildGroups(
      [archivedParent, activeChild],
      "expense",
      "active",
      "",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.showRoot).toBe(false);
    expect(groups[0]?.children).toHaveLength(1);
  });
});

describe("counts, hints and rules", () => {
  it("counts the main categories that are not archived, per kind", () => {
    expect(activeRootCount(all, "expense")).toBe(2);
    expect(activeRootCount(all, "income")).toBe(1);
  });
  it("knows whether anything is archived", () => {
    expect(anyArchived(all)).toBe(true);
    expect(anyArchived([food, rent])).toBe(false);
  });
  it("hints archived, none, one or several subcategories, as many as the list shows", () => {
    const hint = (root: typeof food, children: (typeof food)[] = []) =>
      groupHint({ root, children, showRoot: true });
    expect(hint(old)).toBe("Archived");
    expect(hint(rent)).toBe("No subcategories");
    expect(hint(food, [dining, groceries])).toBe("2 subcategories");
    expect(hint(food, [groceries])).toBe("1 subcategory");
  });
  it("blocks Archive while a parent has an active child, and Unarchive under an archived parent", () => {
    expect(archiveBlocked(all, food)).toBe(true);
    expect(archiveBlocked(all, rent)).toBe(false);
    expect(archiveBlocked(all, groceries)).toBe(false);
    const archivedFood = { ...food, archivedAt: "2026-10-01T00:00:00.000Z" };
    const archivedKid = {
      ...groceries,
      archivedAt: "2026-10-01T00:00:00.000Z",
    };
    expect(archiveBlocked([archivedFood, archivedKid], archivedKid)).toBe(true);
    expect(archiveBlocked([food, archivedKid], archivedKid)).toBe(false);
    expect(archiveBlocked([archivedFood, archivedKid], archivedFood)).toBe(
      false,
    );
  });
  it("says whether every group with subcategories is open", () => {
    const groups = buildGroups(all, "expense", "all", "");
    expect(allOpen(groups, new Set())).toBe(false);
    expect(allOpen(groups, new Set([food.id]))).toBe(true);
    expect(allOpen(groups, new Set([rent.id]))).toBe(false);
    expect(allOpen(buildGroups([rent], "expense", "all", ""), new Set())).toBe(
      false,
    );
  });
});

describe("the status chip", () => {
  it("stands as chosen only while something is archived, All otherwise", () => {
    expect(resolveStatus(null, all)).toBe("all");
    expect(resolveStatus("active", all)).toBe("active");
    expect(resolveStatus("archived", all)).toBe("archived");
    expect(resolveStatus("all", all)).toBe("all");
    expect(resolveStatus("active", [food, rent])).toBe("all");
    expect(resolveStatus("archived", [food, rent])).toBe("all");
    expect(resolveStatus("all", [food, rent])).toBe("all");
  });
  it("lets a parent be archived when its only children are archived already", () => {
    const gone = { ...groceries, archivedAt: "2026-10-01T00:00:00.000Z" };
    expect(archiveBlocked([food, gone], food)).toBe(false);
  });
});
