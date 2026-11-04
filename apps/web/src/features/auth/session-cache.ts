import type { QueryClient } from "@tanstack/react-query";
import { meKey } from "../profile/api";
import { usersKey } from "../users/api";

/** What belongs to the signed-in person alone: who I am (and whether I am the admin) and, for the admin, the people list. */
const personKeys = [meKey, usersKey] as const;
/** What the person's own ledger pages keep. */
const ledgerKeys = [
  ["ledgers"],
  ["accounts"],
  ["categories"],
  ["transactions"],
  ["home"],
  ["contacts"],
  ["receivables"],
  ["clientHistory"],
  ["tags"],
] as const;

/** Forgets what belongs to a person, so whoever signs in next on this browser is never shown it (ADR 0048). */
export function forgetPerson(client: QueryClient) {
  for (const queryKey of personKeys) client.removeQueries({ queryKey });
}

/** Everything the signed-in person's pages kept: the session itself, their ledger's data and who they are. */
export async function forgetSession(client: QueryClient) {
  await client.cancelQueries();
  client.setQueryData(["session"], null);
  for (const queryKey of ledgerKeys) client.removeQueries({ queryKey });
  forgetPerson(client);
}
