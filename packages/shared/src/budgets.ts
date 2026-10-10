import { z } from "zod";
import {
  idSchema,
  ledgerParamsSchema,
  usdMoneySchema,
  versionSchema,
} from "./contracts";
import { homeMonthSchema } from "./home";

/** A budget month in YYYY-MM form; stored as the first day of the month. */
export const budgetMonthSchema = homeMonthSchema;
export const budgetAmountSchema = usdMoneySchema.refine(
  (money) => money.amount >= 0,
  "A budget cannot be negative.",
);
export const budgetSchema = z.object({
  id: idSchema,
  ledgerId: idSchema,
  categoryId: idSchema,
  month: budgetMonthSchema,
  amount: usdMoneySchema,
  rollover: z.boolean(),
  version: versionSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const budgetParamsSchema = ledgerParamsSchema.extend({
  budgetId: idSchema,
});
export const budgetMonthQuerySchema = z.strictObject({
  month: budgetMonthSchema,
});
/** Create the month's budget for a category, or edit it when expectedVersion is given. */
export const setBudgetSchema = z.strictObject({
  categoryId: idSchema,
  month: budgetMonthSchema,
  amount: budgetAmountSchema,
  rollover: z.boolean(),
  expectedVersion: versionSchema.optional(),
});
export const deleteBudgetSchema = z.strictObject({
  expectedVersion: versionSchema,
});
export const copyBudgetsSchema = z
  .strictObject({ fromMonth: budgetMonthSchema, toMonth: budgetMonthSchema })
  .refine(
    (body) => body.fromMonth !== body.toMonth,
    "Choose two different months.",
  );
export const budgetCopyResultSchema = z.object({
  items: z.array(budgetSchema),
});

const moneyField = usdMoneySchema;
export const budgetLineSchema = z.object({
  categoryId: idSchema,
  name: z.string(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  archived: z.boolean(),
  budget: budgetSchema.nullable(),
  /** Leftover carried in from earlier months; zero without rollover. */
  carriedIn: moneyField,
  /** Cleared expenses in the category and its subcategories this month. */
  spent: moneyField,
  /** Budget plus carried-in minus spent; null when the category has no budget. */
  left: moneyField.nullable(),
});
export const budgetMonthSchemaView = z.object({
  month: budgetMonthSchema,
  items: z.array(budgetLineSchema),
  totals: z.object({
    budgeted: moneyField,
    carriedIn: moneyField,
    spent: moneyField,
    left: moneyField,
    /** Spending in categories that have no budget this month. */
    unbudgetedSpent: moneyField,
  }),
});

export type Budget = z.infer<typeof budgetSchema>;
export type BudgetLine = z.infer<typeof budgetLineSchema>;
export type BudgetMonthView = z.infer<typeof budgetMonthSchemaView>;
export type SetBudget = z.infer<typeof setBudgetSchema>;
export type DeleteBudget = z.infer<typeof deleteBudgetSchema>;
export type CopyBudgets = z.infer<typeof copyBudgetsSchema>;

/** The month before a YYYY-MM month, by integer math. */
export function previousMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  const [y, m] = index === 1 ? [year - 1, 12] : [year, index - 1];
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

/**
 * Rollover is computed, never stored (ADR 0019). `rows` are one category's budgets in
 * ascending month order and `spentByMonth` its spending per month. A month carries in the
 * previous month's leftover only when it has rollover on and the previous month has a budget.
 */
export function computeBudgetPositions(
  rows: { month: string; amount: number; rollover: boolean }[],
  spentByMonth: Map<string, number>,
) {
  const positions = new Map<
    string,
    { carriedIn: number; spent: number; left: number }
  >();
  for (const row of rows) {
    const before = positions.get(previousMonth(row.month));
    const carriedIn = row.rollover && before ? before.left : 0;
    const spent = spentByMonth.get(row.month) ?? 0;
    positions.set(row.month, {
      carriedIn,
      spent,
      left: row.amount + carriedIn - spent,
    });
  }
  return positions;
}
