import { createHash } from "node:crypto";
import type { ChangeMarker } from "@ledgerline/shared";
import type { Database } from "../../db/client";
import { accountStamps } from "../accounts/stamp";
import { budgetStamps } from "../budgets/stamp";
import { categoryStamps } from "../categories/stamp";
import { contactStamps } from "../contacts/stamp";
import { currencyStamps } from "../currencies/stamp";
import { importStamps } from "../imports/stamp";
import { requireLedgerRead } from "../ledgers/service";
import { ledgerStamps } from "../ledgers/stamp";
import { receivableStamps } from "../receivables/stamp";
import { recurringStamps } from "../recurring/stamp";
import { tagStamps } from "../tags/stamp";
import { transactionStamps } from "../transactions/stamp";

/**
 * The ledger's change marker (ADR 0044): one hash over every ledger table's row count and newest update, read in
 * one snapshot. It moves whenever anything in the ledger changes (from the web, the phone or a background job), so
 * an open page can poll it cheaply and reload only when it moves. Says nothing about what changed.
 */
export async function getChangeMarker(
  db: Database,
  actorId: string,
  ledgerId: string,
): Promise<ChangeMarker> {
  return db.transaction(
    async (tx) => {
      await requireLedgerRead(tx, actorId, ledgerId);
      const stamps = [
        ...(await ledgerStamps(tx, ledgerId)),
        ...(await accountStamps(tx, ledgerId)),
        ...(await categoryStamps(tx, ledgerId)),
        ...(await tagStamps(tx, ledgerId)),
        ...(await currencyStamps(tx, ledgerId)),
        ...(await transactionStamps(tx, ledgerId)),
        ...(await importStamps(tx, ledgerId)),
        ...(await budgetStamps(tx, ledgerId)),
        ...(await recurringStamps(tx, ledgerId)),
        ...(await contactStamps(tx, ledgerId)),
        ...(await receivableStamps(tx, ledgerId)),
      ];
      const marker = createHash("sha256")
        .update(stamps.join("|"))
        .digest("base64url")
        .slice(0, 22);
      return { marker };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
