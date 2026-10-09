import { createHash } from "node:crypto";
import { idempotencyKeySchema, type JsonValue } from "@ledgerline/shared";
import type { Database, DatabaseTransaction } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { requireLedgerWrite } from "../ledgers/service";
import { writeRepository } from "./repo";

export type WriteIdentity = { actorId: string; ledgerId: string; key: string };
export type WriteResponse = { status: number; body: JsonValue };
export type WriteResult = WriteResponse & { replayed: boolean };
export type WriteContext = {
  tx: DatabaseTransaction;
  actorId: string;
  ledgerId: string;
};

/** Canonical JSON makes equivalent object key orders replay the same request. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (
    value &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  ) {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error("Expected JSON data");
}

export async function runFinancialWrite(
  db: Database,
  input: WriteIdentity & { operation: string; request: JsonValue },
  mutate: (context: WriteContext) => Promise<WriteResponse>,
): Promise<WriteResult> {
  if (!idempotencyKeySchema.safeParse(input.key).success)
    throw new ApiProblem(
      400,
      "Invalid request",
      "Provide a valid Idempotency-Key.",
      [
        {
          field: "Idempotency-Key",
          message:
            "Use 8–128 letters, digits, dots, colons, underscores or hyphens.",
        },
      ],
    );
  if (!input.operation) throw new Error("A write operation is required");
  const requestHash = createHash("sha256")
    .update(canonicalJson({ operation: input.operation, body: input.request }))
    .digest("hex");
  return db.transaction(async (tx) => {
    const repo = writeRepository(tx, input.actorId, input.ledgerId);
    await repo.lock(input.key);
    // Recheck access inside the transaction, including before cached-response replay.
    await requireLedgerWrite(tx, input.actorId, input.ledgerId);
    const previous = await repo.find(input.key);
    if (previous) {
      if (previous.deletedAt || previous.requestHash !== requestHash)
        throw new ApiProblem(
          409,
          "Conflict",
          "This Idempotency-Key cannot be used for this request.",
          [
            {
              field: "Idempotency-Key",
              message:
                "Use a new key for a new action; retry the original action with its original key.",
            },
          ],
        );
      return {
        status: previous.responseStatus,
        body: previous.responseBody,
        replayed: true,
      };
    }
    const response = await mutate({
      tx,
      actorId: input.actorId,
      ledgerId: input.ledgerId,
    });
    if (
      !Number.isInteger(response.status) ||
      response.status < 200 ||
      response.status > 299 ||
      (response.status === 204 && response.body !== null)
    )
      throw new Error("Invalid write response");
    // Verify JSON serializability before commit so response failures also roll back.
    const body = JSON.parse(canonicalJson(response.body)) as JsonValue;
    await repo.save({
      key: input.key,
      requestHash,
      responseStatus: response.status,
      responseBody: body,
    });
    return { status: response.status, body, replayed: false };
  });
}
