import {
  type CreateImport,
  type ImportBatch,
  type ImportPreview,
  newId,
  type PreviewImport,
} from "@ledgerline/shared";
import type { Database } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { importTargetAccount } from "../accounts/lookup-service";
import { requireLedgerRead } from "../ledgers/service";
import {
  createImportedEntries,
  findImportDuplicates,
  importRemainingCounts,
  previewImportRows,
  removeImportedEntries,
} from "../transactions/import-service";
import { runFinancialWrite, type WriteIdentity } from "../writes/service";
import { nextVersion, requireVersionUpdate } from "../writes/version";
import { type ImportBatchRow, importRepository } from "./repo";

const dto = (row: ImportBatchRow, remaining: number): ImportBatch => ({
  id: row.id,
  accountId: row.accountId,
  sourceName: row.sourceName,
  rowCount: row.rowCount,
  remaining,
  createdAt: row.createdAt.toISOString(),
  version: row.version,
});

/** Checks rows without saving anything. The preview exists only in the response. */
export function previewImport(
  db: Database,
  actorId: string,
  ledgerId: string,
  body: PreviewImport,
): Promise<ImportPreview> {
  return db.transaction(
    async (tx) => {
      await requireLedgerRead(tx, actorId, ledgerId);
      const account = await importTargetAccount(tx, ledgerId, body.accountId);
      return previewImportRows({ tx, actorId, ledgerId }, account, body.rows);
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export function createImport(
  db: Database,
  identity: WriteIdentity,
  body: CreateImport,
) {
  return runFinancialWrite(
    db,
    { ...identity, operation: "POST imports", request: body },
    async (context) => {
      const { tx, actorId, ledgerId } = context;
      const account = await importTargetAccount(tx, ledgerId, body.accountId);
      const duplicates = await findImportDuplicates(
        tx,
        ledgerId,
        account.id,
        body.rows,
      );
      const batch = await importRepository(tx, ledgerId).create({
        id: newId(),
        createdBy: actorId,
        accountId: account.id,
        sourceName: body.sourceName,
        rowCount: body.rows.length,
      });
      if (!batch) throw new Error("Import batch was not saved");
      await createImportedEntries(context, batch.id, account.id, body.rows);
      return {
        status: 201,
        body: {
          batch: dto(batch, body.rows.length),
          duplicatesIncluded: duplicates.size,
        },
      };
    },
  );
}

export async function listImports(
  db: Database,
  actorId: string,
  ledgerId: string,
) {
  return db.transaction(
    async (tx) => {
      await requireLedgerRead(tx, actorId, ledgerId);
      const rows = await importRepository(tx, ledgerId).recent(20);
      const counts = await importRemainingCounts(
        tx,
        ledgerId,
        rows.map((row) => row.id),
      );
      return {
        items: rows.map((row) => dto(row, counts.get(row.id) ?? 0)),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export function undoImport(
  db: Database,
  identity: WriteIdentity,
  batchId: string,
  expectedVersion: number,
) {
  return runFinancialWrite(
    db,
    {
      ...identity,
      operation: `POST imports/${batchId.toLowerCase()}/undo`,
      request: { expectedVersion },
    },
    async (context) => {
      const repo = importRepository(context.tx, context.ledgerId);
      const current = await repo.find(batchId.toLowerCase(), true);
      if (!current) throw new ApiProblem(404, "Not found", "Import not found.");
      const version = nextVersion(current.version, expectedVersion);
      const removed = await removeImportedEntries(context, current.id);
      requireVersionUpdate(
        await repo.markUndone(current.id, expectedVersion, version),
      );
      return { status: 200, body: { removed } };
    },
  );
}
