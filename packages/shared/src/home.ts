import { z } from "zod";
import { accountTypeSchema } from "./accounts";
import {
  calendarDateSchema,
  currencySchema,
  idSchema,
  ledgerParamsSchema,
  moneySchema,
  usdMoneySchema,
} from "./contracts";
import { transactionSchema } from "./transactions";

export const homeMonthSchema = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, "Use a month in YYYY-MM format.")
  .refine((month) => Number(month.slice(0, 4)) >= 1, "Use year 0001 or later.");
export const homeQuerySchema = z.strictObject({ month: homeMonthSchema });
export const homeParamsSchema = ledgerParamsSchema;

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/** First and last calendar day of a YYYY-MM month, by integer date math (no time zones). */
export function monthRange(month: string) {
  const parsed = homeMonthSchema.parse(month);
  const year = Number(parsed.slice(0, 4));
  const index = Number(parsed.slice(5, 7));
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    index - 1
  ] as number;
  return {
    start: `${pad(year, 4)}-${pad(index)}-01`,
    end: `${pad(year, 4)}-${pad(index)}-${pad(days)}`,
  };
}

const balanceGroupSchema = z.object({
  count: z.number().int().min(0),
  balance: usdMoneySchema,
});
export const homeAccountSchema = z.object({
  id: idSchema,
  name: z.string(),
  type: accountTypeSchema,
  // In the account's own currency.
  balance: moneySchema,
  // The same balance in the base currency at the newest stored rate; null when no rate exists.
  baseBalance: usdMoneySchema.nullable().default(null),
});
export const homeLatestSchema = z.object({
  transaction: transactionSchema,
  accountName: z.string(),
  categoryLabel: z.string().nullable(),
  counterpartAccountName: z.string().nullable(),
});
export const homeSummarySchema = z.object({
  month: homeMonthSchema,
  monthStart: calendarDateSchema,
  monthEnd: calendarDateSchema,
  // Money in hand: positive balances of active bank, cash, wallet and savings accounts.
  inHand: usdMoneySchema,
  // Signed sum of every non-deleted account (archived included). Not shown on Home; Accounts shows it.
  netWorth: usdMoneySchema,
  // Amount owed on cards and loans (negative balances only, archived included), as a non-negative amount.
  // Balances owed to a client are counted under `loans.borrowed` instead.
  liabilitiesOwed: usdMoneySchema,
  // Money lent to clients (positive client balances) and money borrowed from them (negative ones, as a
  // non-negative amount), valued like accounts; both leave out currencies with no rate (ADR 0030).
  loans: z.object({ lent: usdMoneySchema, borrowed: usdMoneySchema }).default({
    lent: { amount: 0, currency: "USD" },
    borrowed: { amount: 0, currency: "USD" },
  }),
  // Active bank, cash, wallet and savings accounts only; cards and loans never appear here.
  accounts: z.array(homeAccountSchema),
  otherActive: balanceGroupSchema,
  // Archived bank, cash, wallet and savings accounts (not counted in inHand).
  archived: balanceGroupSchema,
  moneyIn: usdMoneySchema,
  moneyOut: usdMoneySchema,
  owed: z.object({
    // Open money owed to you, valued in the base currency at the newest stored rates.
    total: usdMoneySchema,
    personCount: z.number().int().min(0),
    // Non-base currencies someone owes in (so the screen can say the total uses latest rates).
    otherCurrencies: z.array(currencySchema).default([]),
    // Owed currencies with no stored rate yet; they are left out of the total.
    unconvertedCurrencies: z.array(currencySchema).default([]),
  }),
  pendingCount: z.number().int().min(0),
  latest: z.array(homeLatestSchema).max(5),
  setup: z.object({
    hasActiveAccount: z.boolean(),
    hasCategory: z.boolean(),
  }),
  // Currencies with no stored rate yet; their accounts are left out of the base totals above.
  unconvertedCurrencies: z.array(currencySchema).default([]),
});
export type HomeSummary = z.infer<typeof homeSummarySchema>;
export type HomeLatest = z.infer<typeof homeLatestSchema>;
