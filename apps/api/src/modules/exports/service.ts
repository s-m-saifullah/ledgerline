import type { Readable } from "node:stream";
import {
  accountCsvColumns,
  categoryCsvColumns,
  currencyDigits,
  type ExportTransactionsQuery,
  formatMinorUnits,
  formatRate,
  parseRate,
  transactionCsvColumns,
} from "@ledgerline/shared";
import type { Database } from "../../db/client";
import { csvLine, guardedText } from "../../lib/csv";
import { csvDownload } from "../../lib/csv-download";
import { accountExportRows } from "../accounts/export-service";
import { categoryReportRows } from "../categories/report-service";
import { requireLedgerRead } from "../ledgers/service";
import { exportTransactionPage } from "../transactions/export-service";

const decimal = (cents: number, currency: string) =>
  formatMinorUnits(Math.abs(cents), currencyDigits(currency));
const yesNo = (value: boolean) => (value ? "true" : "false");

/**
 * Transactions as CSV, oldest first (ADR 0033). Amounts are positive and `type` is the
 * direction; a transfer is one row (its sending leg); a split entry is one row per line.
 */
export function transactionsCsv(
  db: Database,
  actorId: string,
  ledgerId: string,
  query: ExportTransactionsQuery,
): Promise<Readable> {
  return csvDownload(db, async (tx, csv) => {
    const ledger = await requireLedgerRead(tx, actorId, ledgerId);
    const accounts = new Map(
      (await accountExportRows(tx, ledgerId)).map((row) => [row.id, row.name]),
    );
    const categories = new Map(
      (await categoryReportRows(tx, ledgerId)).map((row) => [row.id, row]),
    );
    const names = (categoryId: string | null) => {
      const category = categoryId ? categories.get(categoryId) : undefined;
      const parent = category?.parentId
        ? categories.get(category.parentId)
        : undefined;
      return parent
        ? [parent.name, category?.name ?? ""]
        : [category?.name ?? "", ""];
    };
    csv.begin();
    await csv.write(csvLine(transactionCsvColumns));
    let after: { date: string; id: string } | null = null;
    for (;;) {
      const page = await exportTransactionPage(tx, ledgerId, query, after);
      let chunk = "";
      for (const row of page.rows) {
        const leg = page.incomingLeg(row.transferId);
        const lines = row.isSplit ? page.linesOf(row.id) : [];
        const common = {
          id: row.id,
          date: row.date,
          time: row.time ?? "",
          type: row.kind,
          currency: row.currency,
          account: guardedText(accounts.get(row.accountId)),
          toAccount: guardedText(leg ? accounts.get(leg.accountId) : null),
          received:
            leg && leg.currency !== row.currency
              ? decimal(leg.amount, leg.currency)
              : "",
          payee: guardedText(row.payee),
          status: row.status,
          rate: formatRate(parseRate(row.fxRate)),
        };
        const emit = (
          line: string,
          amount: number,
          baseAmount: number,
          categoryId: string | null,
          note: string | null,
        ) => {
          const [category, subcategory] = names(categoryId);
          chunk += csvLine([
            common.id,
            common.date,
            common.time,
            common.type,
            decimal(amount, row.currency),
            common.currency,
            common.account,
            common.toAccount,
            common.received,
            guardedText(category),
            guardedText(subcategory),
            common.payee,
            guardedText(note),
            common.status,
            line,
            common.rate,
            decimal(baseAmount, ledger.baseCurrency),
          ]);
        };
        if (lines.length)
          for (const [index, part] of lines.entries())
            emit(
              String(index + 1),
              part.amount,
              part.baseAmount,
              part.categoryId,
              part.note ?? row.note,
            );
        else emit("", row.amount, row.baseAmount, row.categoryId, row.note);
      }
      await csv.write(chunk);
      const last = page.rows.at(-1);
      if (!page.full || !last) break;
      after = { date: last.date, id: last.id };
    }
  });
}

export function accountsCsv(
  db: Database,
  actorId: string,
  ledgerId: string,
): Promise<Readable> {
  return csvDownload(db, async (tx, csv) => {
    await requireLedgerRead(tx, actorId, ledgerId);
    const rows = await accountExportRows(tx, ledgerId);
    csv.begin();
    await csv.write(csvLine(accountCsvColumns));
    await csv.write(
      rows
        .map((row) =>
          csvLine([
            row.id,
            guardedText(row.name),
            row.type,
            row.currency,
            formatMinorUnits(row.openingBalance, currencyDigits(row.currency)),
            yesNo(row.archived),
          ]),
        )
        .join(""),
    );
  });
}

export function categoriesCsv(
  db: Database,
  actorId: string,
  ledgerId: string,
): Promise<Readable> {
  return csvDownload(db, async (tx, csv) => {
    await requireLedgerRead(tx, actorId, ledgerId);
    const rows = await categoryReportRows(tx, ledgerId);
    const byId = new Map(rows.map((row) => [row.id, row]));
    csv.begin();
    await csv.write(csvLine(categoryCsvColumns));
    await csv.write(
      rows
        .map((row) =>
          csvLine([
            row.id,
            guardedText(row.name),
            guardedText(row.parentId ? byId.get(row.parentId)?.name : null),
            row.kind,
            row.color ?? "",
            yesNo(row.archived),
          ]),
        )
        .join(""),
    );
  });
}
