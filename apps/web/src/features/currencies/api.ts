import {
  type ExchangeRate,
  exchangeRateSchema,
  type PinnedCurrency,
  pinnedCurrencySchema,
  type RefreshRatesResult,
  refreshRatesResultSchema,
} from "@ledgerline/shared";
import { prepareFinancialWrite } from "../../lib/api";

const path = (ledgerId: string) => `/ledgers/${ledgerId}`;
export function prepareCurrencyPin(ledgerId: string, code: string) {
  const run = prepareFinancialWrite<unknown>(
    `${path(ledgerId)}/currencies`,
    "POST",
    { code },
  );
  return async (): Promise<PinnedCurrency> =>
    pinnedCurrencySchema.parse(await run());
}
export function prepareCurrencyRemove(
  ledgerId: string,
  currency: PinnedCurrency,
) {
  return prepareFinancialWrite<undefined>(
    `${path(ledgerId)}/currencies/${currency.id}`,
    "DELETE",
    { expectedVersion: currency.version },
  );
}
/** Sets a rate by hand; pass the stored rate to edit it, omit it to create one. */
export function prepareRateSet(
  ledgerId: string,
  body: { code: string; date: string; rate: string },
  existing?: ExchangeRate,
) {
  const run = prepareFinancialWrite<unknown>(
    `${path(ledgerId)}/exchange-rates`,
    "PUT",
    { ...body, ...(existing ? { expectedVersion: existing.version } : {}) },
  );
  return async () => exchangeRateSchema.parse(await run());
}
export function prepareRatesRefresh(ledgerId: string, code?: string) {
  const run = prepareFinancialWrite<unknown>(
    `${path(ledgerId)}/exchange-rates/refresh`,
    "POST",
    code ? { code } : {},
  );
  return async (): Promise<RefreshRatesResult> =>
    refreshRatesResultSchema.parse(await run());
}
