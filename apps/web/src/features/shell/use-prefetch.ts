import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { queryKeys } from "../../lib/query-keys";
import { getActiveAccounts } from "../accounts/api";
import { getCategories } from "../categories/api";

/**
 * Loads what the Add sheet needs as soon as the ledger is known, so the first Add of a visit opens ready whatever page the
 * person is on. It only fills the cache: answers that are still fresh are not asked for again, and a failure is left for
 * the Add sheet to show when it opens.
 */
export function usePrefetchLedgerData(ledgerId: string | undefined) {
  const client = useQueryClient();
  useEffect(() => {
    if (!ledgerId) return;
    void client.prefetchQuery({
      queryKey: queryKeys.activeAccounts(ledgerId),
      queryFn: ({ signal }) => getActiveAccounts(ledgerId, signal),
    });
    void client.prefetchQuery({
      queryKey: queryKeys.categories(ledgerId),
      queryFn: ({ signal }) => getCategories(ledgerId, signal),
    });
  }, [client, ledgerId]);
}
