import { expect, it } from "vitest";
import { category } from "./fixtures.test-helper";
import { moveCategory } from "./tree";

it("moves in persisted sibling order with every expected version and no archived/foreign-group rows", () => {
  const a = category("A", { sortOrder: 1, version: 3 });
  const b = category("B", { sortOrder: 0, version: 2 });
  const old = category("Old", { archivedAt: "2026-10-07T00:00:00.000Z" });
  const child = category("Child", { parentId: a.id });
  const income = category("Income", { kind: "income" });
  const rows = [a, child, old, income, b];
  expect(moveCategory(rows, a, -1)).toEqual({
    kind: "expense",
    parentId: null,
    items: [
      { id: a.id, expectedVersion: 3 },
      { id: b.id, expectedVersion: 2 },
    ],
  });
  expect(moveCategory(rows, b, -1)).toBeNull();
  expect(moveCategory(rows, a, 1)).toBeNull();
});
