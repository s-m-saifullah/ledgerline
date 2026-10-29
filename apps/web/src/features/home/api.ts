import {
  type Account,
  type HomeSummary,
  homeSummarySchema,
} from "@ledgerline/shared";
import { api } from "../../lib/api";
import { getAccounts } from "../accounts/api";

export async function getHome(
  ledgerId: string,
  month: string,
  signal?: AbortSignal,
): Promise<HomeSummary> {
  return homeSummarySchema.parse(
    await api(`/ledgers/${ledgerId}/home?month=${month}`, {
      ...(signal ? { signal } : {}),
    }),
  );
}

/** Every active account, own currency, read page by page (the summary leaves cards and loans out of its list). */
export async function getActiveAccounts(
  ledgerId: string,
  signal?: AbortSignal,
): Promise<Account[]> {
  const found: Account[] = [];
  let cursor: string | null = null;
  // 10 pages of 50 is far more than a personal ledger holds; the cap only stops a runaway loop.
  for (let page = 0; page < 10; page++) {
    const next = await getAccounts(ledgerId, "active", cursor, signal);
    found.push(...next.items);
    if (!next.nextCursor) break;
    cursor = next.nextCursor;
  }
  return found;
}
