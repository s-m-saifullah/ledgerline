import { useQuery } from "@tanstack/react-query";
import { getLedgers } from "./api";
import { queryKeys } from "./query-keys";

/**
 * The person's ledger: the first one the server lists (a person has one; sharing is not built). `ledgerId` is undefined
 * until the ledgers have come, and `writable` is false for a viewer, so a screen never writes by mistake.
 */
export function useLedger() {
  const ledgers = useQuery({
    queryKey: queryKeys.ledgers,
    queryFn: getLedgers,
  });
  const ledger = ledgers.data?.items[0];
  return {
    ledger,
    ledgerId: ledger?.id,
    writable: !!ledger && ledger.role !== "viewer",
    ledgers,
  };
}
