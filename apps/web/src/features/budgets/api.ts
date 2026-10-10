import {
  type Budget,
  type BudgetMonthView,
  budgetCopyResultSchema,
  budgetMonthSchemaView,
  budgetSchema,
} from "@ledgerline/shared";
import { api, prepareFinancialWrite } from "../../lib/api";

const path = (ledgerId: string) => `/ledgers/${ledgerId}/budgets`;
export async function getBudgetMonth(
  ledgerId: string,
  month: string,
  signal?: AbortSignal,
): Promise<BudgetMonthView> {
  return budgetMonthSchemaView.parse(
    await api(`${path(ledgerId)}?month=${month}`, {
      ...(signal ? { signal } : {}),
    }),
  );
}
/** Creates the month's budget, or edits it when `existing` is given. */
export function prepareBudgetSave(
  ledgerId: string,
  body: {
    categoryId: string;
    month: string;
    amount: number;
    rollover: boolean;
  },
  existing?: Budget,
) {
  const run = prepareFinancialWrite<unknown>(path(ledgerId), "PUT", {
    categoryId: body.categoryId,
    month: body.month,
    amount: { amount: body.amount, currency: "USD" },
    rollover: body.rollover,
    ...(existing ? { expectedVersion: existing.version } : {}),
  });
  return async () => budgetSchema.parse(await run());
}
export function prepareBudgetRemove(ledgerId: string, budget: Budget) {
  return prepareFinancialWrite<undefined>(
    `${path(ledgerId)}/${budget.id}`,
    "DELETE",
    { expectedVersion: budget.version },
  );
}
export function prepareBudgetCopy(
  ledgerId: string,
  fromMonth: string,
  toMonth: string,
) {
  const run = prepareFinancialWrite<unknown>(`${path(ledgerId)}/copy`, "POST", {
    fromMonth,
    toMonth,
  });
  return async () => budgetCopyResultSchema.parse(await run());
}
