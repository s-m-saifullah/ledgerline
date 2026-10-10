import { currencySchema, rateFromNumber } from "@ledgerline/shared";
import { z } from "zod";

/** One fetched rate: base-currency value of one unit of `code` on `date`. */
export type FetchedRate = { date: string; rate: string };
/** Returns null when the source has no usable rate; never throws. */
export type RateFetcher = (
  code: string,
  base: string,
  date?: string,
) => Promise<FetchedRate | null>;

const TIMEOUT_MS = 5000;
const MAX_BYTES = 200_000;
// Only currency codes and a date ever leave the server; no amounts, payees or notes.
const primary = z
  .array(
    z.object({
      date: z.iso.date(),
      base: currencySchema,
      quote: currencySchema,
      rate: z.number(),
    }),
  )
  .min(1);

async function getJson(fetchImpl: typeof fetch, url: string) {
  const response = await fetchImpl(url, {
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!response.ok) return null;
  const text = await response.text();
  if (text.length > MAX_BYTES) return null;
  return JSON.parse(text) as unknown;
}
async function fromFrankfurter(
  fetchImpl: typeof fetch,
  code: string,
  base: string,
  date?: string,
): Promise<FetchedRate | null> {
  const query = new URLSearchParams({ base: code, quotes: base });
  if (date) query.set("date", date);
  const parsed = primary.safeParse(
    await getJson(fetchImpl, `https://api.frankfurter.dev/v2/rates?${query}`),
  );
  const row = parsed.success ? parsed.data[0] : undefined;
  const rate = row ? rateFromNumber(row.rate) : null;
  return row && rate && row.base === code && row.quote === base
    ? { date: row.date, rate }
    : null;
}
async function fromFallback(
  fetchImpl: typeof fetch,
  code: string,
  base: string,
  date?: string,
): Promise<FetchedRate | null> {
  const lower = code.toLowerCase();
  const json = await getJson(
    fetchImpl,
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date ?? "latest"}/v1/currencies/${lower}.json`,
  );
  const root = z.record(z.string(), z.unknown()).safeParse(json);
  if (!root.success) return null;
  const published = z.iso.date().safeParse(root.data.date);
  const table = z.record(z.string(), z.number()).safeParse(root.data[lower]);
  if (!published.success || !table.success) return null;
  const value = table.data[base.toLowerCase()];
  const rate = value === undefined ? null : rateFromNumber(value);
  return rate ? { date: published.data, rate } : null;
}

/** The documented primary source with the documented fallback (docs/PHASE_2B_PLAN.md). */
export function createRateProvider(
  fetchImpl: typeof fetch = fetch,
): RateFetcher {
  return async (code, base, date) => {
    for (const source of [fromFrankfurter, fromFallback]) {
      try {
        const found = await source(fetchImpl, code, base, date);
        if (found) return found;
      } catch {
        // Try the next source; failures are reported by the caller as "failed".
      }
    }
    return null;
  };
}
