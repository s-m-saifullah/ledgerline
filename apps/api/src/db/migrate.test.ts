import { describe, expect, it, vi } from "vitest";
import { requireTestDatabase } from "../test-support/harness";
import { createDatabase } from "./client";
import { applyMigrations } from "./migrate";

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return { ...actual, createDatabase: vi.fn(actual.createDatabase) };
});

const url = requireTestDatabase("Migration tests");

describe("applying migrations", () => {
  it("runs without a statement or idle-in-transaction limit, so a slow migration is never cut off at start-up", async () => {
    await applyMigrations(url);

    expect(createDatabase).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        statementTimeoutMillis: 0,
        idleInTransactionMillis: 0,
      }),
    );
  });
});
