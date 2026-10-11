import {
  type Account,
  type CreateRecurringRule,
  createRecurringRuleSchema,
  currencyDigits,
  type RecurringFrequency,
  type RecurringRule,
} from "@ledgerline/shared";
import { decimalFromCents } from "../accounts/money";
import { amountMessage, amountMinor } from "../transactions/form";

export type RuleFormValues = {
  title: string;
  kind: "expense" | "income" | "transfer";
  accountId: string;
  toAccountId: string;
  categoryId: string;
  amount: string;
  receivedAmount: string;
  bonusOn: boolean;
  bonusAmount: string;
  bonusCategoryId: string;
  payee: string;
  note: string;
  frequency: RecurringFrequency;
  interval: string;
  startDate: string;
  endDate: string;
};
export type RuleFormErrors = Partial<Record<keyof RuleFormValues, string>>;

export function ruleDefaults(
  accounts: readonly Account[],
  today: string,
): RuleFormValues {
  return {
    title: "",
    kind: "expense",
    accountId: accounts.find((row) => !row.archivedAt)?.id ?? "",
    toAccountId: "",
    categoryId: "",
    amount: "",
    receivedAmount: "",
    bonusOn: false,
    bonusAmount: "",
    bonusCategoryId: "",
    payee: "",
    note: "",
    frequency: "month",
    interval: "1",
    startDate: today,
    endDate: "",
  };
}
export function valuesFromRule(rule: RecurringRule): RuleFormValues {
  return {
    title: rule.title,
    kind: rule.kind,
    accountId: rule.accountId,
    toAccountId: rule.toAccountId ?? "",
    categoryId: rule.categoryId ?? "",
    amount: decimalFromCents(
      Math.abs(rule.amount.amount),
      currencyDigits(rule.amount.currency),
    ),
    receivedAmount: rule.receivedAmount
      ? decimalFromCents(
          rule.receivedAmount.amount,
          currencyDigits(rule.receivedAmount.currency),
        )
      : "",
    bonusOn: !!rule.bonus,
    bonusAmount: rule.bonus
      ? decimalFromCents(
          rule.bonus.amount.amount,
          currencyDigits(rule.bonus.amount.currency),
        )
      : "",
    bonusCategoryId: rule.bonus?.categoryId ?? "",
    payee: rule.payee ?? "",
    note: rule.note ?? "",
    frequency: rule.frequency,
    interval: String(rule.interval),
    startDate: rule.startDate,
    endDate: rule.endDate ?? "",
  };
}

/** Turns what was typed into the request, or says which field to fix. */
export function ruleBody(
  values: RuleFormValues,
  accounts: readonly Account[],
): { body: CreateRecurringRule } | { errors: RuleFormErrors } {
  const errors: RuleFormErrors = {};
  const from = accounts.find((row) => row.id === values.accountId);
  const to = accounts.find((row) => row.id === values.toAccountId);
  const transfer = values.kind === "transfer";
  if (!values.title.trim()) errors.title = "Give it a name, such as Rent.";
  if (!from) errors.accountId = "Choose an account.";
  if (transfer && !to) errors.toAccountId = "Choose the receiving account.";
  if (transfer && from && to && from.id === to.id)
    errors.toAccountId = "Choose two different accounts.";
  if (!transfer && !values.categoryId) errors.categoryId = "Choose a category.";
  const currency = from?.currency ?? "USD";
  const minor = amountMinor(values.amount, currency);
  if (minor === null) errors.amount = amountMessage(currency);
  const crossCurrency =
    transfer && !!from && !!to && from.currency !== to.currency;
  const received =
    crossCurrency && to
      ? amountMinor(values.receivedAmount, to.currency)
      : null;
  if (crossCurrency && to && received === null)
    errors.receivedAmount = amountMessage(to.currency);
  const bonus =
    transfer && values.bonusOn && to
      ? amountMinor(values.bonusAmount, to.currency)
      : null;
  if (transfer && values.bonusOn && to) {
    if (bonus === null) errors.bonusAmount = amountMessage(to.currency);
    if (!values.bonusCategoryId)
      errors.bonusCategoryId = "Choose an income category for the bonus.";
  }
  const interval = Number(values.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > 365)
    errors.interval = "Use a whole number from 1 to 365.";
  if (!values.startDate) errors.startDate = "Choose a start date.";
  if (values.endDate && values.startDate && values.endDate < values.startDate)
    errors.endDate = "The end date cannot be before the start date.";
  if (Object.keys(errors).length > 0) return { errors };
  const parsed = createRecurringRuleSchema.safeParse({
    title: values.title,
    kind: values.kind,
    accountId: values.accountId,
    toAccountId: transfer ? values.toAccountId : null,
    categoryId: transfer ? null : values.categoryId,
    amount: {
      amount: values.kind === "expense" ? -(minor ?? 0) : (minor ?? 0),
      currency,
    },
    receivedAmount:
      crossCurrency && to && received !== null
        ? { amount: received, currency: to.currency }
        : null,
    bonus:
      transfer && values.bonusOn && to && bonus !== null
        ? {
            amount: { amount: bonus, currency: to.currency },
            categoryId: values.bonusCategoryId,
          }
        : null,
    payee: transfer ? null : values.payee.trim() || null,
    note: values.note.trim() || null,
    frequency: values.frequency,
    interval,
    startDate: values.startDate,
    endDate: values.endDate || null,
  });
  if (!parsed.success)
    return { errors: { title: "Check the details and try again." } };
  return { body: parsed.data };
}
