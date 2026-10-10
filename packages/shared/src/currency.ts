import { z } from "zod";
import {
  currencySchema,
  idSchema,
  ledgerParamsSchema,
  versionSchema,
} from "./contracts";

/** Digits after the decimal point for a currency's smallest unit (USD 2, JPY 0, BHD 3). */
export function currencyDigits(code: string): number {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
  }).resolvedOptions().maximumFractionDigits as number;
}

/** Rates carry at most this many digits after the point. */
export const RATE_DECIMALS = 10;
const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS);
const MAX_RATE_DIGITS = 10;

/**
 * An exchange rate is the number of base-currency units one unit of the other currency is
 * worth, as exact decimal text such as "0.0081967213". Never a float.
 */
export const rateSchema = z
  .string()
  .regex(
    new RegExp(`^\\d{1,${MAX_RATE_DIGITS}}(?:\\.\\d{1,${RATE_DECIMALS}})?$`),
    `Use a decimal rate with up to ${RATE_DECIMALS} digits after the point.`,
  )
  .refine((text) => {
    try {
      return parseRate(text) > 0n;
    } catch {
      return false;
    }
  }, "A rate must be greater than zero.");

/** The rate as a whole number of 10^-10 units. */
export function parseRate(text: string): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error("Invalid rate");
  const fraction = (match[2] ?? "").padEnd(RATE_DECIMALS, "0");
  if (fraction.length > RATE_DECIMALS) throw new Error("Invalid rate");
  return BigInt(match[1] ?? "0") * RATE_SCALE + BigInt(fraction);
}

/** Exact decimal text for a scaled rate, with trailing zeros trimmed ("1" for one). */
export function formatRate(scaled: bigint): string {
  const whole = scaled / RATE_SCALE;
  const fraction = String(scaled % RATE_SCALE)
    .padStart(RATE_DECIMALS, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** Turn a provider's JSON number into exact rate text without exponent notation. */
export function rateFromNumber(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const text = value.toFixed(RATE_DECIMALS);
  const parsed = parseRate(text);
  return parsed > 0n ? formatRate(parsed) : null;
}

/**
 * Convert an amount in the smallest units of `from` into the smallest units of `to` at the
 * given rate (units of `to` per one unit of `from`). Rounds half away from zero, exactly,
 * with integer arithmetic. Throws when the result leaves the safe integer range.
 */
export function convertMinor(
  amount: number,
  rate: string,
  from: string,
  to: string,
): number {
  if (!Number.isSafeInteger(amount)) throw new RangeError("Invalid amount");
  const negative = amount < 0;
  const magnitude = BigInt(negative ? -amount : amount);
  const numerator =
    magnitude * parseRate(rate) * 10n ** BigInt(currencyDigits(to));
  const denominator = RATE_SCALE * 10n ** BigInt(currencyDigits(from));
  // Adding half the divisor before dividing rounds a magnitude half away from zero.
  const rounded = (numerator * 2n + denominator) / (denominator * 2n);
  const signed = negative ? -rounded : rounded;
  if (
    signed > BigInt(Number.MAX_SAFE_INTEGER) ||
    signed < BigInt(Number.MIN_SAFE_INTEGER)
  )
    throw new RangeError("Converted amount exceeds the safe integer range");
  return Number(signed);
}

export const rateSourceSchema = z.enum(["api", "manual"]);
export const currencyParamsSchema = ledgerParamsSchema.extend({
  currencyId: idSchema,
});
export const exchangeRateParamsSchema = ledgerParamsSchema.extend({
  rateId: idSchema,
});
export const exchangeRateSchema = z.object({
  id: idSchema,
  ledgerId: idSchema,
  code: currencySchema,
  date: z.iso.date(),
  rate: rateSchema,
  source: rateSourceSchema,
  version: versionSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const pinnedCurrencySchema = z.object({
  id: idSchema,
  ledgerId: idSchema,
  code: currencySchema,
  version: versionSchema,
  latestRate: exchangeRateSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const currencyListSchema = z.object({
  baseCurrency: currencySchema,
  items: z.array(pinnedCurrencySchema),
});
/** A currency other than the base one; the base currency is always available. */
export const pinCurrencySchema = z.strictObject({ code: currencySchema });
export const unpinCurrencySchema = z.strictObject({
  expectedVersion: versionSchema,
});
export const exchangeRateListQuerySchema = z.object({
  code: currencySchema,
  limit: z.coerce.number().int().min(1).max(200).default(60),
});
export const exchangeRateListSchema = z.object({
  items: z.array(exchangeRateSchema),
});
/** Set a rate by hand; it is marked manual and never overwritten by a fetch. */
export const setExchangeRateSchema = z.strictObject({
  code: currencySchema,
  date: z.iso.date(),
  rate: rateSchema,
  expectedVersion: versionSchema.optional(),
});
export const deleteExchangeRateSchema = z.strictObject({
  expectedVersion: versionSchema,
});
export const refreshRatesSchema = z.strictObject({
  code: currencySchema.optional(),
});
export const refreshRatesResultSchema = z.object({
  updated: z.number().int().min(0),
  keptManual: z.number().int().min(0),
  failed: z.array(currencySchema),
});

export type ExchangeRate = z.infer<typeof exchangeRateSchema>;
export type PinnedCurrency = z.infer<typeof pinnedCurrencySchema>;
export type CurrencyList = z.infer<typeof currencyListSchema>;
export type SetExchangeRate = z.infer<typeof setExchangeRateSchema>;
export type RefreshRatesResult = z.infer<typeof refreshRatesResultSchema>;
