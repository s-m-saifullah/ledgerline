import { describe, expect, it } from "vitest";
import {
  basicCategoryStarterSet,
  categoryMergeSchema,
  categoryStarterAddOns,
  categoryStarterGroups,
  createCategorySchema,
  createCategoryStarterSetSchema,
  defaultCategoryStarterSet,
  defaultStarterGroupKeys,
  newId,
  reorderCategoriesSchema,
  starterAddOnGroupKeys,
  starterGroupKeys,
  unarchiveCategorySchema,
  updateCategorySchema,
} from "./index";

describe("category contracts", () => {
  it("requires a complete versioned merge confirmation with a bounded fingerprint and rejects extra mutations", () => {
    const body = {
      destinationCategoryId: newId(),
      expectedSourceVersion: 1,
      expectedDestinationVersion: 2,
      previewToken: "a".repeat(64),
    };
    expect(categoryMergeSchema.parse(body)).toEqual(body);
    for (const invalid of [
      { ...body, previewToken: undefined },
      { ...body, previewToken: "a".repeat(63) },
      { ...body, previewToken: "G".repeat(64) },
      { ...body, expectedSourceVersion: 0 },
      { ...body, expectedDestinationVersion: 2147483648 },
      { ...body, amount: "100" },
    ])
      expect(categoryMergeSchema.safeParse(invalid).success).toBe(false);
  });
  it("requires a valid expected version and rejects extra unarchive fields", () => {
    expect(unarchiveCategorySchema.parse({ expectedVersion: 2 })).toEqual({
      expectedVersion: 2,
    });
    for (const body of [
      {},
      { expectedVersion: 0 },
      { expectedVersion: 1.5 },
      { expectedVersion: 2, parentId: null },
    ])
      expect(unarchiveCategorySchema.safeParse(body).success).toBe(false);
  });
  it("provides explicit nullable defaults and accepts the previewable starter set", () => {
    expect(
      createCategorySchema.parse({ name: " Food ", kind: "expense" }),
    ).toEqual({
      name: "Food",
      kind: "expense",
      parentId: null,
      icon: null,
      color: null,
    });
    for (const input of basicCategoryStarterSet)
      expect(createCategorySchema.safeParse(input).success).toBe(true);
    expect(createCategoryStarterSetSchema.safeParse({}).success).toBe(false);
  });
  it("defines a valid two-level default starter set and optional add-ons with unique names and no accounts", () => {
    expect(defaultCategoryStarterSet.map((group) => group.key)).toEqual([
      ...defaultStarterGroupKeys,
    ]);
    expect(categoryStarterAddOns.map((group) => group.key)).toEqual([
      ...starterAddOnGroupKeys,
    ]);
    expect(categoryStarterGroups.map((group) => group.key)).toEqual([
      ...starterGroupKeys,
    ]);
    const names = new Set<string>();
    let total = 0;
    for (const group of categoryStarterGroups) {
      for (const name of [group.name, ...group.children]) {
        expect(names.has(name.toLowerCase())).toBe(false);
        names.add(name.toLowerCase());
        total++;
        expect(
          createCategorySchema.safeParse({
            name,
            kind: group.kind,
            icon: group.icon,
            color: group.color,
          }).success,
        ).toBe(true);
      }
    }
    expect(total).toBe(37 + 19);
    for (const starterSet of ["default", "personal"])
      expect(
        createCategoryStarterSetSchema.safeParse({ starterSet }).success,
      ).toBe(true);
    expect(
      createCategoryStarterSetSchema.safeParse({
        starterSet: "default",
        groups: ["salary", "students"],
      }).success,
    ).toBe(true);
    for (const body of [
      { starterSet: "default", groups: [] },
      { starterSet: "default", groups: ["salary", "salary"] },
      { starterSet: "default", groups: ["unknown"] },
      { starterSet: "default", groups: ["wages"] },
      { starterSet: "basic", groups: ["salary"] },
    ])
      expect(createCategoryStarterSetSchema.safeParse(body).success).toBe(
        false,
      );
  });
  it("keeps starter names plain: no parentheses, digits or lowercase-only labels", () => {
    for (const group of categoryStarterGroups)
      for (const name of [group.name, ...group.children]) {
        expect(name).not.toMatch(/[()\d]/);
        expect(name[0]).toBe(name[0]?.toUpperCase());
      }
  });
  it("allows clearing metadata and moving to the root while rejecting kind changes and version-only edits", () => {
    expect(
      updateCategorySchema.safeParse({
        expectedVersion: 1,
        icon: null,
        color: null,
        parentId: null,
      }).success,
    ).toBe(true);
    for (const body of [
      { expectedVersion: 1 },
      { expectedVersion: 1, kind: "income" },
      { expectedVersion: 0, name: "Food" },
      { expectedVersion: 1, icon: "https://example.com" },
      { expectedVersion: 1, color: "#fff" },
    ])
      expect(updateCategorySchema.safeParse(body).success).toBe(false);
  });
  it("requires unique reorder IDs, a bounded group and a version for every sibling", () => {
    const id = newId();
    for (const items of [
      [],
      [{ id }],
      [
        { id, expectedVersion: 1 },
        { id: id.toUpperCase(), expectedVersion: 1 },
      ],
      Array.from({ length: 1001 }, () => ({ id: newId(), expectedVersion: 1 })),
    ])
      expect(
        reorderCategoriesSchema.safeParse({ kind: "expense", items }).success,
      ).toBe(false);
    expect(
      reorderCategoriesSchema.parse({
        kind: "income",
        items: [{ id, expectedVersion: 1 }],
      }).parentId,
    ).toBeNull();
  });
});
