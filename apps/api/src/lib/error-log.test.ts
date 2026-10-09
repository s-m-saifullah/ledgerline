import { describe, expect, it } from "vitest";
import { safeErrorFields } from "./error-log";

describe("safeErrorFields", () => {
  it("keeps only class, SQLSTATE and schema names from a wrapped driver error", () => {
    const driver = Object.assign(
      new Error('duplicate key value violates "x" Key (note)=(Rent 4500)'),
      {
        code: "23505",
        constraint: "transactions_pkey",
        table: "transactions",
        detail: "Key (payee)=(Alice) already exists.",
      },
    );
    const wrapped = new Error("Failed query: insert ... params: 4500,Alice", {
      cause: driver,
    });
    wrapped.name = "DrizzleQueryError";
    const fields = safeErrorFields(wrapped);
    expect(fields).toEqual({
      errorName: "DrizzleQueryError",
      pgCode: "23505",
      constraint: "transactions_pkey",
      table: "transactions",
    });
    expect(JSON.stringify(fields)).not.toMatch(/Alice|4500|Rent/);
  });
  it("drops anything that does not look like an identifier and handles non-errors", () => {
    expect(
      safeErrorFields(
        Object.assign(new Error("boom"), {
          code: "not-a-code",
          constraint: "bad name; payee=Bob",
        }),
      ),
    ).toEqual({
      errorName: "Error",
      pgCode: undefined,
      constraint: undefined,
      table: undefined,
    });
    expect(safeErrorFields("a string")).toEqual({
      errorName: undefined,
      pgCode: undefined,
      constraint: undefined,
      table: undefined,
    });
  });
});
