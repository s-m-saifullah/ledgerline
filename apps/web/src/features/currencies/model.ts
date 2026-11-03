import type {
  ExchangeRate,
  PinnedCurrency,
  RefreshRatesResult,
} from "@ledgerline/shared";
import { rateSentence } from "../../lib/rate-format";

export const refreshFailed = "Couldn't refresh the rates. Please try again.";

/** Where a stored rate came from, as the Source pill says it. */
export const sourceLabel = (rate: Pick<ExchangeRate, "source">) =>
  rate.source === "manual" ? "Set by you" : "Fetched";

/** The one hint of a row: the newest rate, base currency first, and who set it. */
export const rateHint = (item: PinnedCurrency, base: string) =>
  item.latestRate
    ? `${rateSentence(item.code, item.latestRate.rate, base)} · ${item.latestRate.source === "manual" ? "set by you" : "fetched"}`
    : "No rate yet";

/** What a refresh did, in the words the owner has always read: updated, kept and not fetched. */
export function refreshNotice(result: RefreshRatesResult) {
  const parts = [
    result.updated
      ? `Updated ${result.updated} ${result.updated === 1 ? "rate" : "rates"}.`
      : "Rates are already up to date.",
  ];
  if (result.keptManual)
    parts.push(`Kept ${result.keptManual} you set yourself.`);
  if (result.failed.length)
    parts.push(
      `Couldn't fetch ${result.failed.join(", ")}. You can set those by hand.`,
    );
  return parts.join(" ");
}
