import type {
  JsonValue,
  SyncMutation,
  SyncPushResponse,
  SyncResult,
} from "@ledgerline/shared";
import type { Database } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { requireLedgerWrite } from "../ledgers/service";
import {
  applyEntryMutation,
  applyTransferMutation,
  type SyncOutcome,
} from "../transactions/sync-write-service";
import { runFinancialWrite } from "../writes/service";

/** What goes into the write fingerprint: everything that decides the change, but not `editedAt`. */
function fingerprint(mutation: SyncMutation): JsonValue {
  return {
    type: mutation.type,
    ...(mutation.targetId ? { targetId: mutation.targetId.toLowerCase() } : {}),
    ...(mutation.baseVersion === undefined
      ? {}
      : { baseVersion: mutation.baseVersion }),
    body: mutation.body as JsonValue,
  };
}

async function applyOne(
  db: Database,
  identity: { actorId: string; ledgerId: string },
  mutation: SyncMutation,
  receivedAt: Date,
): Promise<SyncResult> {
  try {
    const written = await runFinancialWrite(
      db,
      {
        ...identity,
        // The mutation id is the idempotency key: a retry of the same mutation changes nothing a second time.
        key: mutation.id,
        operation: `SYNC ${mutation.type}`,
        request: fingerprint(mutation),
      },
      async (context) => {
        const outcome: SyncOutcome = mutation.type.startsWith("transfer.")
          ? await applyTransferMutation(context, mutation, receivedAt)
          : await applyEntryMutation(context, mutation, receivedAt);
        return { status: 200, body: outcome as unknown as JsonValue };
      },
    );
    const outcome = written.body as unknown as SyncOutcome;
    return {
      id: mutation.id,
      // A repeat of a change that lost keeps saying so; any other repeat is a replay.
      status: written.replayed
        ? outcome.status === "superseded"
          ? "superseded"
          : "replayed"
        : outcome.status,
      rows: outcome.rows,
    };
  } catch (error) {
    // An expected problem rejects only this mutation; the rest of the batch still runs.
    if (error instanceof ApiProblem)
      return {
        id: mutation.id,
        status: "rejected",
        rows: [],
        problem: {
          status: error.statusCode,
          title: error.title,
          detail: error.detail,
          ...(error.errors.length > 0 ? { errors: error.errors } : {}),
        },
      };
    throw error;
  }
}

/**
 * Applies the phone's offline changes in order (ADR 0042). Each mutation is its own idempotent write, so a
 * batch that is cut off and sent again changes nothing twice, and one that fails does not stop the others.
 * Viewers cannot push and a ledger the caller is not in is 404, for the whole request.
 */
export async function pushMutations(
  db: Database,
  actorId: string,
  ledgerId: string,
  mutations: SyncMutation[],
): Promise<SyncPushResponse> {
  await db.transaction((tx) => requireLedgerWrite(tx, actorId, ledgerId));
  const receivedAt = new Date();
  const results: SyncResult[] = [];
  for (const mutation of mutations)
    results.push(
      await applyOne(db, { actorId, ledgerId }, mutation, receivedAt),
    );
  return { results };
}
