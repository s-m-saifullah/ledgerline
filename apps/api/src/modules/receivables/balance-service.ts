import type { Money } from "@ledgerline/shared";
import type { DatabaseConnection } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { latestRates } from "../currencies/service";
import { convertOrConflict } from "../transactions/pricing";
import { receivableRepository } from "./repo";
export function safeOwed(value: bigint | string) {
  const n = BigInt(value);
  if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER))
    throw new ApiProblem(
      409,
      "Conflict",
      "Outstanding total exceeds the supported money range.",
    );
  return Number(n);
}
type Summary = { contactId: string; currency: string; total: string };
/**
 * Open balances valued in the base currency at the newest stored rate (ADR 0022). Money owed
 * in a currency with no stored rate is left out of the total and named instead.
 */
async function valued(
  db: DatabaseConnection,
  ledgerId: string,
  base: string,
  rows: readonly { currency: string; amount: number }[],
) {
  const rates = await latestRates(
    db,
    ledgerId,
    rows.map((row) => row.currency).filter((code) => code !== base),
  );
  const unconverted = new Set<string>();
  let total = 0n;
  for (const row of rows) {
    if (row.currency === base) total += BigInt(row.amount);
    else {
      const rate = rates.get(row.currency);
      if (rate)
        total += BigInt(
          convertOrConflict(row.amount, rate, row.currency, base),
        );
      else unconverted.add(row.currency);
    }
  }
  return { total: safeOwed(total), unconverted: [...unconverted].sort() };
}
const byCurrency = (a: Money, b: Money) => a.currency.localeCompare(b.currency);
export async function clientBalances(
  db: DatabaseConnection,
  ledgerId: string,
  base = "USD",
) {
  const rows = (await receivableRepository(db, ledgerId).summaries()).rows;
  const clients = new Map<
    string,
    { amounts: Money[]; oldest: string | null }
  >();
  for (const r of rows) {
    const client = clients.get(r.contactId) ?? { amounts: [], oldest: null };
    client.amounts.push({ amount: safeOwed(r.total), currency: r.currency });
    if (r.oldest && (!client.oldest || r.oldest < client.oldest))
      client.oldest = r.oldest;
    clients.set(r.contactId, client);
  }
  const result = new Map<
    string,
    {
      amounts: Money[];
      amount: number;
      unconverted: string[];
      oldest: string | null;
    }
  >();
  for (const [id, client] of clients) {
    const worth = await valued(db, ledgerId, base, client.amounts);
    result.set(id, {
      amounts: client.amounts.sort(byCurrency),
      amount: worth.total,
      unconverted: worth.unconverted,
      oldest: client.oldest,
    });
  }
  return result;
}
/** Call under the category ledger lock for writes. */
async function owedTotal(db: DatabaseConnection, ledgerId: string) {
  const rows = (await receivableRepository(db, ledgerId).summaries()).rows;
  const totals = new Map<string, bigint>();
  for (const r of rows)
    totals.set(r.currency, (totals.get(r.currency) ?? 0n) + BigInt(r.total));
  for (const total of totals.values()) safeOwed(total);
  return totals;
}
/** Open owed total (in the base currency at the newest rates) and the clients who owe money. */
export async function owedOverview(
  db: DatabaseConnection,
  ledgerId: string,
  base = "USD",
) {
  const rows = (await receivableRepository(db, ledgerId).summaries()).rows;
  const totals = new Map<string, bigint>();
  for (const r of rows)
    totals.set(r.currency, (totals.get(r.currency) ?? 0n) + BigInt(r.total));
  const amounts = [...totals].map(([currency, total]) => ({
    currency,
    amount: safeOwed(total),
  }));
  const worth = await valued(db, ledgerId, base, amounts);
  return {
    total: worth.total,
    unconvertedCurrencies: worth.unconverted,
    otherCurrencies: amounts
      .map((row) => row.currency)
      .filter((code) => code !== base)
      .sort(),
    personCount: new Set(rows.map((r: Summary) => r.contactId)).size,
  };
}
export async function checkOwedLimits(
  db: DatabaseConnection,
  ledgerId: string,
) {
  // Each client's and the ledger's open total per currency must stay in the exact range.
  const rows = (await receivableRepository(db, ledgerId).summaries()).rows;
  for (const r of rows) safeOwed(r.total);
  await owedTotal(db, ledgerId);
}
/** Caller holds the contact assignment lock. */
export async function requireNoReceivables(
  db: DatabaseConnection,
  ledgerId: string,
  id: string,
) {
  if (await receivableRepository(db, ledgerId).hasContact(id))
    throw new ApiProblem(
      409,
      "Conflict",
      "Delete connected services first, or archive this client to keep their history.",
    );
}
