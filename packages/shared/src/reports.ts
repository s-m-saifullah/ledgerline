import { z } from "zod";
import { idSchema, ledgerParamsSchema, usdMoneySchema } from "./contracts";
import { homeMonthSchema } from "./home";

export const reportParamsSchema = ledgerParamsSchema;
export const spendingReportQuerySchema = z.strictObject({
  month: homeMonthSchema,
});
export const cashFlowReportQuerySchema = z.strictObject({
  to: homeMonthSchema,
  months: z.coerce.number().int().min(1).max(24).default(12),
});

const categorySpendSchema = z.object({
  categoryId: idSchema,
  name: z.string(),
  color: z.string().nullable(),
  archived: z.boolean(),
  amount: usdMoneySchema,
  // Share of the month's total spending in basis points (100 = 1%), rounded; shares may not add up to exactly 10000.
  shareBps: z.number().int().min(0).max(10000),
});
export const spendingReportSchema = z.object({
  month: homeMonthSchema,
  monthStart: z.iso.date(),
  monthEnd: z.iso.date(),
  total: usdMoneySchema,
  // Top-level categories, largest first; a parent's amount includes its subcategories.
  categories: z.array(
    categorySpendSchema.extend({
      children: z.array(categorySpendSchema),
    }),
  ),
});
export const cashFlowReportSchema = z.object({
  from: homeMonthSchema,
  to: homeMonthSchema,
  months: z.array(
    z.object({
      month: homeMonthSchema,
      income: usdMoneySchema,
      spending: usdMoneySchema,
      net: usdMoneySchema,
    }),
  ),
});
export const netWorthReportQuerySchema = cashFlowReportQuerySchema;
export const netWorthReportSchema = z.object({
  from: homeMonthSchema,
  to: homeMonthSchema,
  months: z.array(
    z.object({
      month: homeMonthSchema,
      // The day the point is as of: the month's last day, or today for the current month (later months repeat today).
      asOf: z.iso.date(),
      netWorth: usdMoneySchema,
      // Currencies with no stored rate on or before asOf; their accounts are left out of netWorth.
      unconvertedCurrencies: z.array(z.string()),
    }),
  ),
});
export type SpendingReport = z.infer<typeof spendingReportSchema>;
export type CashFlowReport = z.infer<typeof cashFlowReportSchema>;
export type NetWorthReport = z.infer<typeof netWorthReportSchema>;

/** The `count` months ending at `to` (YYYY-MM), oldest first, by integer month math. */
export function monthsEndingAt(to: string, count: number) {
  const parsed = homeMonthSchema.parse(to);
  const end = Number(parsed.slice(0, 4)) * 12 + Number(parsed.slice(5, 7)) - 1;
  return Array.from({ length: count }, (_, i) => {
    const index = end - (count - 1 - i);
    const year = Math.floor(index / 12);
    return `${String(year).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
  });
}
