import {
  type HomeSummary,
  isAssetAccountType,
  monthRange,
} from "@ledgerline/shared";
import type { Database } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { accountBalanceOverview } from "../accounts/home-service";
import { categoryLabelOverview } from "../categories/home-service";
import { latestRates } from "../currencies/service";
import { requireLedgerRead } from "../ledgers/service";
import { owedOverview } from "../receivables/balance-service";
import { homeTransactionOverview } from "../transactions/home-service";
import { convertOrConflict } from "../transactions/pricing";

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
const group = (rows: { baseBalance: number | null }[]) => ({
  count: rows.length,
  balance: usd(
    rows.reduce((sum, row) => sum + BigInt(row.baseBalance ?? 0), 0n),
  ),
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
      const ledger = await requireLedgerRead(tx, actorId, ledgerId);
      const base = ledger.baseCurrency;
      const rows = await accountBalanceOverview(tx, ledgerId);
      // Balances are valued at the newest stored rate; spending and income use frozen amounts.
      const rates = await latestRates(
        tx,
        ledgerId,
        rows.map((row) => row.currency).filter((code) => code !== base),
      );
      const unconverted = new Set<string>();
      const accounts = rows.map((row) => {
        let baseBalance: number | null = null;
        if (row.currency === base) baseBalance = row.balance;
        else {
          const rate = rates.get(row.currency);
          if (rate)
            baseBalance = convertOrConflict(
              row.balance,
              rate,
              row.currency,
              base,
            );
          else unconverted.add(row.currency);
        }
        return { ...row, baseBalance };
      });
      // Accounts whose currency has no rate yet are left out of the base totals.
      const counted = accounts.filter((row) => row.baseBalance !== null);
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
      const valued = (row: { baseBalance: number | null }) =>
        BigInt(row.baseBalance ?? 0);
      return {
        month,
        monthStart: range.start,
        monthEnd: range.end,
        inHand: usd(
          activeAssets.reduce(
            (sum, row) => (valued(row) > 0n ? sum + valued(row) : sum),
            0n,
          ),
        ),
        netWorth: usd(counted.reduce((sum, row) => sum + valued(row), 0n)),
        liabilitiesOwed: usd(
          debts.reduce(
            (sum, row) => (valued(row) < 0n ? sum - valued(row) : sum),
            0n,
          ),
        ),
        accounts: activeAssets.slice(0, SHOWN_ACCOUNTS).map((row) => ({
          id: row.id,
          name: row.name,
          type: row.type,
          balance: { amount: row.balance, currency: row.currency },
          baseBalance: row.baseBalance === null ? null : usd(row.baseBalance),
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
        unconvertedCurrencies: [...unconverted].sort(),
      };
    },
    { isolationLevel: "repeatable read" },
  );
}
