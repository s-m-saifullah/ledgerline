import { describe, expect, it } from "vitest";
import { allocateSerially } from "./receipts";

const open = (...amounts: number[]) =>
  amounts.map((outstanding, i) => ({ id: `s${i}`, outstanding }));

describe("allocateSerially", () => {
  it("pays older services first and leaves the last one partly paid", () => {
    expect(allocateSerially(50000, open(20000, 20000, 30000))).toEqual({
      allocations: [
        { id: "s0", applied: 20000, remainingAfter: 0 },
        { id: "s1", applied: 20000, remainingAfter: 0 },
        { id: "s2", applied: 10000, remainingAfter: 20000 },
      ],
      unapplied: 0,
    });
  });
  it("stops once the money runs out and never allocates zero", () => {
    expect(allocateSerially(20000, open(20000, 5000)).allocations).toEqual([
      { id: "s0", applied: 20000, remainingAfter: 0 },
    ]);
  });
  it("reports money that cannot be applied", () => {
    expect(allocateSerially(900, open(500)).unapplied).toBe(400);
  });
  it("stays exact near the safe-integer limit", () => {
    const big = Number.MAX_SAFE_INTEGER - 1;
    const result = allocateSerially(big, open(big - 1, 5));
    expect(result.allocations).toEqual([
      { id: "s0", applied: big - 1, remainingAfter: 0 },
      { id: "s1", applied: 1, remainingAfter: 4 },
    ]);
    expect(result.unapplied).toBe(0);
  });
  it("skips already-paid entries", () => {
    expect(allocateSerially(10, open(0, 10)).allocations).toEqual([
      { id: "s1", applied: 10, remainingAfter: 0 },
    ]);
  });
});
