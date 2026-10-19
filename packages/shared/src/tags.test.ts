import { describe, expect, it } from "vitest";
import { newId } from "./index";
import { createTagSchema, maxTagsPerEntry, tagIdsSchema } from "./tags";

describe("tag names", () => {
  it("trims and accepts ordinary names", () => {
    expect(createTagSchema.parse({ name: "  Trip to Sylhet " }).name).toBe(
      "Trip to Sylhet",
    );
    expect(createTagSchema.safeParse({ name: "x".repeat(40) }).success).toBe(
      true,
    );
  });
  it("rejects empty, long, separator and control characters", () => {
    for (const name of ["", "  ", "x".repeat(41), "a,b", "a;b", "a\nb"])
      expect(createTagSchema.safeParse({ name }).success, name).toBe(false);
  });
});
describe("tag id lists", () => {
  it("allows up to the limit without repeats", () => {
    const ids = Array.from({ length: maxTagsPerEntry }, () => newId());
    expect(tagIdsSchema.safeParse(ids).success).toBe(true);
    expect(tagIdsSchema.safeParse([...ids, newId()]).success).toBe(false);
    expect(tagIdsSchema.safeParse([ids[0], ids[0]]).success).toBe(false);
    expect(tagIdsSchema.safeParse([]).success).toBe(true);
  });
});
