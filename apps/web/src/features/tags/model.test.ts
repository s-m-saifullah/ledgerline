import { newId, type Tag } from "@ledgerline/shared";
import { expect, it } from "vitest";
import { splitTags, tagHint, tagNameMessage } from "./model";

const tag = (name: string, over: Partial<Tag> = {}): Tag => ({
  id: newId(),
  ledgerId: newId(),
  name,
  archivedAt: null,
  usageCount: 0,
  version: 1,
  createdAt: "2026-10-05T00:00:00.000Z",
  updatedAt: "2026-10-05T00:00:00.000Z",
  ...over,
});

it("says how many entries use a tag, in the singular for one", () => {
  expect(tagHint(tag("Trip", { usageCount: 0 }))).toBe("0 entries");
  expect(tagHint(tag("Trip", { usageCount: 1 }))).toBe("1 entry");
  expect(tagHint(tag("Trip", { usageCount: 12 }))).toBe("12 entries");
});
it("sorts by name and keeps the archived tags apart", () => {
  const { active, archived } = splitTags(
    [
      tag("trip"),
      tag("Gift"),
      tag("old", { archivedAt: "2026-10-06T00:00:00.000Z" }),
      tag("Ångström"),
    ],
    "",
  );
  expect(active.map((item) => item.name)).toEqual(["Ångström", "Gift", "trip"]);
  expect(archived.map((item) => item.name)).toEqual(["old"]);
});
it("searches both lists by part of a name, ignoring case and outer spaces", () => {
  const items = [
    tag("Holiday trip"),
    tag("Gift"),
    tag("Old trip", { archivedAt: "2026-10-06T00:00:00.000Z" }),
  ];
  const found = splitTags(items, "  TRIP ");
  expect(found.active.map((item) => item.name)).toEqual(["Holiday trip"]);
  expect(found.archived.map((item) => item.name)).toEqual(["Old trip"]);
  expect(splitTags(items, "zzz")).toEqual({ active: [], archived: [] });
});
it("names the rule for a tag name once", () => {
  expect(tagNameMessage).toBe(
    "Use 1 to 40 characters, without commas or semicolons, for a tag name.",
  );
});
