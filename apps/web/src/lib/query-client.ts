import { QueryClient } from "@tanstack/react-query";
import { getLedgers } from "./api";
import { queryKeys } from "./query-keys";

/**
 * The defaults for every query. Answers stay fresh for 30 seconds and nothing retries on its own. A window gaining focus
 * reloads nothing: the change marker asks the server then (and every 15 seconds), and reloads exactly what changed
 * (ADR 0044), so a second reload on focus would only repeat it.
 */
export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false },
    },
  });

/**
 * Starts the ledgers request beside the session request, since almost every screen needs the ledger as soon as the session
 * is known. Nobody signed in is not an error here: the request fails quietly and is made again when a screen asks.
 */
export const prefetchStartup = (client: QueryClient) =>
  client.prefetchQuery({ queryKey: queryKeys.ledgers, queryFn: getLedgers });
