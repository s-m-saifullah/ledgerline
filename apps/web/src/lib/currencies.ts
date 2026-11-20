import {
  type CurrencyList,
  currencyListSchema,
  type RateLookup,
  rateLookupSchema,
} from "@ledgerline/shared";
import { api } from "./api";

const path = (ledgerId: string) => `/ledgers/${ledgerId}`;
export async function getCurrencies(
  ledgerId: string,
  signal?: AbortSignal,
): Promise<CurrencyList> {
  return currencyListSchema.parse(
    await api(`${path(ledgerId)}/currencies`, {
      ...(signal ? { signal } : {}),
    }),
  );
}

/** The rate an entry in `code` on `date` would be saved with (null when none exists yet). */
export async function getRateLookup(
  ledgerId: string,
  code: string,
  date: string,
  signal?: AbortSignal,
): Promise<RateLookup> {
  const query = new URLSearchParams({ code, date });
  return rateLookupSchema.parse(
    await api(`${path(ledgerId)}/exchange-rates/lookup?${query}`, {
      ...(signal ? { signal } : {}),
    }),
  );
}
