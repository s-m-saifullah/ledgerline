import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../../lib/query-keys";
import { getActiveAccounts, getAllAccounts, pickableAccounts } from "./api";

/**
 * The ledger's active accounts: one request and one cache entry for Home, the Add sheet, loans and the import, so the
 * Add sheet opens ready once any of them (or the shell's prefetch) has loaded it. `ownOnly` leaves out a client's balance
 * account, for screens where a person picks an account by hand; it filters what is read, never what is cached.
 */
export function useActiveAccounts(
  ledgerId: string | undefined,
  { ownOnly = false, enabled = true } = {},
) {
  return useQuery({
    queryKey: queryKeys.activeAccounts(ledgerId),
    queryFn: ({ signal }) => getActiveAccounts(ledgerId as string, signal),
    enabled: !!ledgerId && enabled,
    ...(ownOnly ? { select: pickableAccounts } : {}),
  });
}

/** The ledger's accounts, archived ones too (names on old entries, balances in Insights). */
export function useAllAccounts(ledgerId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.allAccounts(ledgerId),
    queryFn: ({ signal }) => getAllAccounts(ledgerId as string, signal),
    enabled: !!ledgerId && enabled,
  });
}
