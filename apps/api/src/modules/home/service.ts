import {
  type HomeSummary,
  isAssetAccountType,
  monthRange,
} from "@ledgerline/shared";
import type { Database } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { accountBalanceOverview } from "../accounts/home-service";
import { categoryLabelOverview } from "../categories/home-service";
import { requireLedgerRead } from "../ledgers/service";
import { owedOverview } from "../receivables/balance-service";
import { homeTransactionOverview } from "../transactions/home-service";

const SHOWN_ACCOUNTS = 8;
const LATEST = 5;

function safe(value: bigint) {
  if (
    value < BigInt(Number.MIN_SAFE_INTEGER) ||
    value > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new ApiProblem(
      409,
      "Conflict",
      "A Home total exceeds the supported exact money range.",
    );
  return Number(value);
}
const usd = (amount: bigint | number) => ({
  amount: typeof amount === "bigint" ? safe(amount) : amount,
  currency: "USD" as const,
});
const group = (rows: { balance: number }[]) => ({
  count: rows.length,
  balance: usd(rows.reduce((sum, row) => sum + BigInt(row.balance), 0n)),
});

/** One repeatable-read snapshot so totals, balances and latest rows always agree. */
export async function getHomeSummary(
  db: Database,
  actorId: string,
  ledgerId: string,
  month: string,
): Promise<HomeSummary> {
  const range = monthRange(month);
  return db.transaction(
    async (tx) => {
      await requireLedgerRead(tx, actorId, ledgerId);
      const accounts = await accountBalanceOverview(tx, ledgerId);
      const flow = await homeTransactionOverview(
        tx,
        ledgerId,
        range.start,
        range.end,
        LATEST,
      );
      const owed = await owedOverview(tx, ledgerId);
      const categories = await categoryLabelOverview(tx, ledgerId);
      const active = accounts.filter((row) => !row.archived);
      const names = new Map(accounts.map((row) => [row.id, row.name]));
      const assets = accounts.filter((row) => isAssetAccountType(row.type));
      const activeAssets = assets.filter((row) => !row.archived);
      const debts = accounts.filter((row) => !isAssetAccountType(row.type));
      return {
        month,
        monthStart: range.start,
        monthEnd: range.end,
        inHand: usd(
          activeAssets.reduce(
            (sum, row) => (row.balance > 0 ? sum + BigInt(row.balance) : sum),
            0n,
          ),
        ),
        netWorth: usd(
          accounts.reduce((sum, row) => sum + BigInt(row.balance), 0n),
        ),
        liabilitiesOwed: usd(
          debts.reduce(
            (sum, row) => (row.balance < 0 ? sum - BigInt(row.balance) : sum),
            0n,
          ),
        ),
        accounts: activeAssets.slice(0, SHOWN_ACCOUNTS).map((row) => ({
          id: row.id,
          name: row.name,
          type: row.type,
          balance: usd(row.balance),
        })),
        otherActive: group(activeAssets.slice(SHOWN_ACCOUNTS)),
        archived: group(assets.filter((row) => row.archived)),
        moneyIn: usd(flow.income),
        moneyOut: usd(flow.spending),
        owed: { total: usd(owed.total), personCount: owed.personCount },
        pendingCount: flow.pendingCount,
        latest: flow.latest.map((row) => ({
          transaction: row.transaction,
          accountName: names.get(row.transaction.accountId) ?? "Account",
          categoryLabel: row.transaction.categoryId
            ? (categories.labels.get(row.transaction.categoryId) ?? null)
            : null,
          counterpartAccountName: row.destinationAccountId
            ? (names.get(row.destinationAccountId) ?? null)
            : null,
        })),
        setup: {
          hasActiveAccount: active.length > 0,
          hasCategory: categories.hasActive,
        },
      };
    },
    { isolationLevel: "repeatable read" },
  );
}
