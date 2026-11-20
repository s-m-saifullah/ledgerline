import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../../lib/query-keys";
import { getCategories } from "./api";

/** The ledger's categories (archived ones included): one request and one cache entry for every screen that reads them. */
export function useCategories(ledgerId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.categories(ledgerId),
    queryFn: ({ signal }) => getCategories(ledgerId as string, signal),
    enabled: !!ledgerId && enabled,
  });
}
