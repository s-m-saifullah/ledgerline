import {
  createTransactionSchema,
  createTransferSchema,
  type SyncMutation,
  transferVersionSchema,
  updateTransactionSchema,
  updateTransferSchema,
} from "@ledgerline/shared";
import { eq } from "drizzle-orm";
import type { DatabaseTransaction } from "../../db/client";
import { transactions } from "../../db/schema";
import { ApiProblem } from "../../lib/problem";
import type { WriteContext } from "../writes/service";
import { transactionRepository } from "./repo";
import {
  createTransactionInContext,
  deleteTransactionInContext,
  updateTransactionInContext,
} from "./service";
import { syncRowsForEntry, syncRowsForTransfer } from "./sync-service";
import { transferRepository } from "./transfer-repo";
import {
  createTransferInContext,
  transferLifecycleInContext,
  updateTransferInContext,
} from "./transfer-service";

/** What a pushed mutation did: applied now, or not applied because the server's row is newer (ADR 0042). */
export type SyncOutcome = {
  status: "applied" | "superseded";
  rows: ReturnType<typeof syncRowsForEntry> extends Promise<infer Rows>
    ? Rows
    : never;
};

/**
 * Last write wins per row. A change made against the version the server still has always applies. If the
 * row has changed since, the later edit wins, comparing the phone's `editedAt` (never later than the moment
 * the server received it, so a fast phone clock cannot win for ever) with the row's last update; a tie goes
 * to the server.
 */
export function decideSyncEdit(input: {
  currentVersion: number;
  baseVersion: number;
  currentUpdatedAt: Date;
  editedAt: Date;
  receivedAt: Date;
}): "apply" | "superseded" {
  if (input.currentVersion === input.baseVersion) return "apply";
  const claimed =
    input.editedAt < input.receivedAt ? input.editedAt : input.receivedAt;
  return claimed > input.currentUpdatedAt ? "apply" : "superseded";
}

function invalid(error: {
  issues: { path: PropertyKey[]; message: string }[];
}) {
  return new ApiProblem(
    400,
    "Invalid request",
    "Check the mutation fields.",
    error.issues.map((issue) => ({
      field: issue.path.map(String).join(".") || "body",
      message: issue.message,
    })),
  );
}
const missing = (field: string) =>
  new ApiProblem(400, "Invalid request", "Check the mutation fields.", [
    { field, message: "This mutation needs it." },
  ]);

/** An id taken by any entry, in any ledger: a client-made id must be new everywhere. */
async function entryIdTaken(tx: DatabaseTransaction, id: string) {
  const found = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.id, id))
    .limit(1);
  return found.length > 0;
}
const idInUse = () =>
  new ApiProblem(409, "Conflict", "This id is already in use.", [
    { field: "id", message: "Use a new id for a new row." },
  ]);

/** Applies one entry mutation inside an open write (the caller owns the receipt and the transaction). */
export async function applyEntryMutation(
  context: WriteContext,
  mutation: SyncMutation,
  receivedAt: Date,
): Promise<SyncOutcome> {
  const { tx, ledgerId } = context;
  if (mutation.type === "transaction.create") {
    const parsed = createTransactionSchema.safeParse(mutation.body);
    if (!parsed.success) throw invalid(parsed.error);
    if (await entryIdTaken(tx, mutation.id)) throw idInUse();
    await createTransactionInContext(context, parsed.data, {
      id: mutation.id,
    });
    return {
      status: "applied",
      rows: await syncRowsForEntry(tx, ledgerId, mutation.id),
    };
  }
  const targetId = mutation.targetId;
  if (!targetId) throw missing("targetId");
  if (mutation.baseVersion === undefined) throw missing("baseVersion");
  const current = await transactionRepository(tx, ledgerId).find(
    targetId,
    true,
    true,
  );
  if (!current)
    throw new ApiProblem(404, "Not found", "Transaction not found.");
  const rows = () => syncRowsForEntry(tx, ledgerId, targetId);
  if (current.deletedAt)
    // Deleting what is already deleted is done; editing it loses to the delete.
    return {
      status: mutation.type === "transaction.delete" ? "applied" : "superseded",
      rows: await rows(),
    };
  const decision = decideSyncEdit({
    currentVersion: current.version,
    baseVersion: mutation.baseVersion,
    currentUpdatedAt: current.updatedAt,
    editedAt: new Date(mutation.editedAt),
    receivedAt,
  });
  if (decision === "superseded")
    return { status: "superseded", rows: await rows() };
  if (mutation.type === "transaction.delete")
    await deleteTransactionInContext(context, targetId, {
      expectedVersion: current.version,
    });
  else {
    const parsed = updateTransactionSchema.safeParse({
      ...mutation.body,
      expectedVersion: current.version,
    });
    if (!parsed.success) throw invalid(parsed.error);
    await updateTransactionInContext(context, targetId, parsed.data);
  }
  return { status: "applied", rows: await rows() };
}

/** Applies one transfer mutation inside an open write; the id is the transfer's `transferId`. */
export async function applyTransferMutation(
  context: WriteContext,
  mutation: SyncMutation,
  receivedAt: Date,
): Promise<SyncOutcome> {
  const { tx, ledgerId } = context;
  const repo = transferRepository(tx, ledgerId);
  if (mutation.type === "transfer.create") {
    const parsed = createTransferSchema.safeParse(mutation.body);
    if (!parsed.success) throw invalid(parsed.error);
    if ((await repo.find(mutation.id, false, true)).length > 0) throw idInUse();
    await createTransferInContext(context, parsed.data, mutation.id);
    return {
      status: "applied",
      rows: await syncRowsForTransfer(tx, ledgerId, mutation.id),
    };
  }
  const targetId = mutation.targetId;
  if (!targetId) throw missing("targetId");
  if (mutation.baseVersion === undefined) throw missing("baseVersion");
  const legs = await repo.find(targetId, true, true);
  const from = legs.find((row) => row.amount < 0);
  if (legs.length !== 2 || !from)
    throw new ApiProblem(404, "Not found", "Transfer not found.");
  const rows = () => syncRowsForTransfer(tx, ledgerId, targetId);
  if (from.deletedAt)
    return {
      status: mutation.type === "transfer.delete" ? "applied" : "superseded",
      rows: await rows(),
    };
  const decision = decideSyncEdit({
    currentVersion: from.version,
    baseVersion: mutation.baseVersion,
    currentUpdatedAt: from.updatedAt,
    editedAt: new Date(mutation.editedAt),
    receivedAt,
  });
  if (decision === "superseded")
    return { status: "superseded", rows: await rows() };
  if (mutation.type === "transfer.delete") {
    const parsed = transferVersionSchema.safeParse({
      ...mutation.body,
      expectedVersion: from.version,
    });
    if (!parsed.success) throw invalid(parsed.error);
    await transferLifecycleInContext(context, targetId, parsed.data, false);
  } else {
    const parsed = updateTransferSchema.safeParse({
      ...mutation.body,
      expectedVersion: from.version,
    });
    if (!parsed.success) throw invalid(parsed.error);
    await updateTransferInContext(context, targetId, parsed.data);
  }
  return { status: "applied", rows: await rows() };
}
