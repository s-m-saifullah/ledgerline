import type { QueryClient } from "@tanstack/react-query";
import { forgetMarkers } from "../../lib/ledger-cache";
import { queryKeys } from "../../lib/query-keys";

/** What belongs to the signed-in person alone: who I am (and whether I am the admin) and, for the admin, the people list. */
const personKeys = [queryKeys.me, queryKeys.users] as const;

/** Forgets what belongs to a person, so whoever signs in next on this browser is never shown it (ADR 0048). */
export function forgetPerson(client: QueryClient) {
  for (const queryKey of personKeys) client.removeQueries({ queryKey });
}

/**
 * Everything the signed-in person's pages kept: the session itself, every answer in the cache whatever page asked for it
 * (a list of keys would miss the next page someone adds) and the finished changes, which hold what was typed. The session
 * entry stays, set to nobody, so a page that is watching it sees the sign-out.
 */
export async function forgetSession(client: QueryClient) {
  await client.cancelQueries();
  forgetMarkers(client);
  client.setQueryData(queryKeys.session, null);
  client.removeQueries({
    predicate: (query) => query.queryKey[0] !== queryKeys.session[0],
  });
  client.getMutationCache().clear();
}
