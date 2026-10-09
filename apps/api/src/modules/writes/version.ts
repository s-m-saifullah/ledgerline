import { versionSchema } from "@ledgerline/shared";
import { ApiProblem } from "../../lib/problem";

export function versionConflict(): ApiProblem {
  return new ApiProblem(
    409,
    "Conflict",
    "This record changed. Reload it before trying again.",
    [
      {
        field: "expectedVersion",
        message: "Use the version from the latest record.",
      },
    ],
  );
}

export function nextVersion(current: number, expected: number): number {
  if (!versionSchema.safeParse(expected).success)
    throw new ApiProblem(
      400,
      "Invalid request",
      "Provide a valid expectedVersion.",
      [
        {
          field: "expectedVersion",
          message: "Use a positive integer version.",
        },
      ],
    );
  if (!versionSchema.safeParse(current).success)
    throw new Error("Invalid stored version");
  if (current !== expected || current === 2_147_483_647)
    throw versionConflict();
  return current + 1;
}

/** Call after an UPDATE scoped by ledger, record ID, active state and expected version. */
export function requireVersionUpdate<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (!row) throw versionConflict();
  if (rows.length !== 1) throw new Error("Expected one updated record");
  return row;
}
