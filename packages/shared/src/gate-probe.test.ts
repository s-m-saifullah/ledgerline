import { expect, it } from "vitest";

// Throwaway: proves that the final `check` job fails when a suite fails. Never merged.
it("fails on purpose", () => {
  expect(1).toBe(2);
});
