import { useQuery } from "@tanstack/react-query";
import { getCategories } from "./categories";
import { queryKeys } from "./query-keys";

/** The ledger's categories (archived ones included): one request and one cache entry for every screen that reads them. */
export function useCategories(ledgerId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.categories(ledgerId),
    queryFn: ({ signal }) => getCategories(ledgerId as string, signal),
    enabled: !!ledgerId && enabled,
  });
}
