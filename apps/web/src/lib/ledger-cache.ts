import type { ChangeMarker } from "@ledgerline/shared";
import type { QueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { queryKeys } from "./query-keys";

/** Asks the server for the ledger's change marker (ADR 0044). */
export const fetchChangeMarker = (ledgerId: string) =>
  api<ChangeMarker>(`/ledgers/${ledgerId}/changes`);

/**
 * The newest marker the page has accounted for, per ledger. The live-update check reloads the screen when the marker it
 * reads is not this one; a write the page made itself records its own marker here, so the check does not reload for it a
 * second time.
 */
const seen = new WeakMap<QueryClient, Map<string, string>>();
export const seenMarker = (client: QueryClient, ledgerId: string) =>
  seen.get(client)?.get(ledgerId);
export function rememberMarker(
  client: QueryClient,
  ledgerId: string,
  marker: string,
) {
  const markers = seen.get(client) ?? new Map<string, string>();
  markers.set(ledgerId, marker);
  seen.set(client, markers);
}
export const forgetMarkers = (client: QueryClient) => seen.delete(client);

/**
 * Reads the ledger's marker now and remembers it as accounted for. Anyone who reloads more than a ledger's own queries
 * after a write (clearing a ledger reloads everything) calls this first; `invalidateLedger` does it for you. A marker that
 * cannot be read only means the next check may reload once more.
 */
export async function recordMarker(client: QueryClient, ledgerId: string) {
  try {
    const { marker } = await fetchChangeMarker(ledgerId);
    if (typeof marker === "string") rememberMarker(client, ledgerId, marker);
  } catch {
    // Offline, or the server said no: the reload that follows says so by itself.
  }
}

/**
 * Refreshes what a write may have changed: call it after any write to a ledger, so no screen keeps a hand-picked list.
 * Everything on screen for that ledger reloads, and what is not on screen is marked out of date and loads when it opens;
 * nothing of another ledger or of the signed-in person is touched. It is always the whole ledger: the marker it records
 * stands for the whole ledger, so refreshing only some of it would hide a change made elsewhere in the rest.
 *
 * The marker is read first, then the reload starts: a change made elsewhere before the read is in what reloads, and one
 * made after it moves the marker again, so the next check still finds it.
 */
export async function invalidateLedger(
  client: QueryClient,
  ledgerId: string,
): Promise<void> {
  await recordMarker(client, ledgerId);
  await client.invalidateQueries({ queryKey: queryKeys.ledger(ledgerId) });
}
