import { useQuery } from "@tanstack/react-query";
import { getTags } from "./api";

/** The ledger's tags (archived included); pickers and chips read names from here. */
export function useTags(ledgerId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["tags", ledgerId],
    queryFn: ({ signal }) => getTags(ledgerId as string, signal),
    enabled: !!ledgerId && enabled,
  });
}
