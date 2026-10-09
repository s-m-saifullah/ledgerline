import type { DatabaseConnection } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
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
export async function personBalances(db: DatabaseConnection, ledgerId: string) {
  const rows = await receivableRepository(db, ledgerId).summaries();
  return new Map(
    rows.rows.map((r) => [
      r.contactId,
      { amount: safeOwed(r.total), oldest: r.oldest },
    ]),
  );
}
/** Call under the category ledger lock for writes. */
export async function owedTotal(db: DatabaseConnection, ledgerId: string) {
  const rows = await receivableRepository(db, ledgerId).summaries();
  return safeOwed(rows.rows.reduce((s, r) => s + BigInt(r.total), 0n));
}
/** Open owed total and the number of people who currently owe money. */
export async function owedOverview(db: DatabaseConnection, ledgerId: string) {
  const rows = (await receivableRepository(db, ledgerId).summaries()).rows;
  return {
    total: safeOwed(rows.reduce((s, r) => s + BigInt(r.total), 0n)),
    personCount: rows.length,
  };
}
export async function checkOwedLimits(
  db: DatabaseConnection,
  ledgerId: string,
) {
  await personBalances(db, ledgerId);
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
      "Delete connected services first, or archive this person to keep their history.",
    );
}
