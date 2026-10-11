import { z } from "zod";
import {
  idSchema,
  ledgerParamsSchema,
  moneySchema,
  versionSchema,
} from "./contracts";
import { transactionDateSchema } from "./transactions";

export const recurringFrequencySchema = z.enum([
  "day",
  "week",
  "month",
  "year",
]);
export type RecurringFrequency = z.infer<typeof recurringFrequencySchema>;
export const recurringKindSchema = z.enum(["expense", "income", "transfer"]);

export type Schedule = {
  frequency: RecurringFrequency;
  interval: number;
  startDate: string;
};

// Calendar arithmetic on plain year/month/day numbers, so time zones and daylight saving never
// enter: a schedule works on calendar dates only (ADR 0024).
const isLeap = (year: number) =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const daysInMonth = (year: number, month: number) =>
  month === 2
    ? isLeap(year)
      ? 29
      : 28
    : [4, 6, 9, 11].includes(month)
      ? 30
      : 31;
/** Days since 1970-01-01 (proleptic Gregorian). */
function toDays(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy =
    Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
function fromDays(days: number): [number, number, number] {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe -
      Math.floor(doe / 1460) +
      Math.floor(doe / 36524) -
      Math.floor(doe / 146096)) /
      365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (month <= 2 ? 1 : 0), month, day];
}
function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y as number, m as number, d as number];
}
const format = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * The nth occurrence (0 is the start date), always calculated from the start date and never from
 * the previous occurrence, so a rule starting on the 31st gives Jan 31, Feb 28, Mar 31 without
 * drifting. A day a month does not have clamps to the month's last day. Null past year 9999.
 */
export function occurrence(schedule: Schedule, n: number): string | null {
  const [y, m, d] = parts(schedule.startDate);
  const step = n * schedule.interval;
  let result: string;
  if (schedule.frequency === "day" || schedule.frequency === "week") {
    const days =
      toDays(y, m, d) + step * (schedule.frequency === "week" ? 7 : 1);
    const [ry, rm, rd] = fromDays(days);
    result = format(ry, rm, rd);
    if (ry > 9999) return null;
  } else {
    const months = schedule.frequency === "month" ? step : step * 12;
    const index = y * 12 + (m - 1) + months;
    const ry = Math.floor(index / 12);
    const rm = (index % 12) + 1;
    if (ry > 9999) return null;
    result = format(ry, rm, Math.min(d, daysInMonth(ry, rm)));
  }
  return result;
}

/** The first occurrence on or after `date`, with its index; null past year 9999. */
export function firstOccurrenceOnOrAfter(
  schedule: Schedule,
  date: string,
): { index: number; date: string } | null {
  const [sy, sm, sd] = parts(schedule.startDate);
  const [y, m, d] = parts(date);
  let estimate: number;
  if (schedule.frequency === "day" || schedule.frequency === "week") {
    const gap = toDays(y, m, d) - toDays(sy, sm, sd);
    estimate = Math.floor(
      gap / (schedule.interval * (schedule.frequency === "week" ? 7 : 1)),
    );
  } else {
    const gap = (y - sy) * 12 + (m - sm);
    estimate = Math.floor(
      gap / (schedule.interval * (schedule.frequency === "month" ? 1 : 12)),
    );
  }
  for (let index = Math.max(0, estimate - 2); ; index++) {
    const found = occurrence(schedule, index);
    if (found === null) return null;
    if (found >= date) return { index, date: found };
  }
}

/** The occurrence after `date` (a date that is itself an occurrence, or any date). */
export function occurrenceAfter(schedule: Schedule, date: string) {
  const [year, month, day] = fromDays(toDays(...parts(date)) + 1);
  if (year > 9999) return null;
  const next = firstOccurrenceOnOrAfter(schedule, format(year, month, day));
  return next?.date ?? null;
}

/** Occurrences from `from` through `to` (inclusive), at most `limit`. */
export function occurrencesBetween(
  schedule: Schedule,
  from: string,
  to: string,
  limit = 1000,
): string[] {
  const first = firstOccurrenceOnOrAfter(schedule, from);
  const found: string[] = [];
  for (let index = first?.index ?? 0; first && found.length < limit; index++) {
    const date = occurrence(schedule, index);
    if (date === null || date > to) break;
    found.push(date);
  }
  return found;
}

const moneyAmount = (message: string) =>
  moneySchema.refine((money) => money.amount > 0, { message });
const bonus = z.strictObject({
  amount: moneyAmount("Enter a positive bonus amount."),
  categoryId: idSchema,
});
const ruleFields = {
  title: z.string().trim().min(1).max(80),
  kind: recurringKindSchema,
  // The account that is paid from or into; for a transfer, the account it leaves.
  accountId: idSchema,
  toAccountId: idSchema.nullable(),
  categoryId: idSchema.nullable(),
  // Signed like an entry: expenses negative, income positive; a transfer is positive.
  amount: moneySchema,
  // Cross-currency transfers only: the fixed amount that arrives (ADR 0024).
  receivedAmount: moneyAmount("Enter a positive received amount.").nullable(),
  // Transfers only: an explicit bonus, confirmed when the rule is saved (ADR 0024).
  bonus: bonus.nullable(),
  payee: z.string().trim().max(200).nullable(),
  note: z.string().trim().max(2000).nullable(),
  frequency: recurringFrequencySchema,
  interval: z.number().int().min(1).max(365),
  startDate: transactionDateSchema,
  endDate: transactionDateSchema.nullable(),
};
type RuleShape = {
  kind: string;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  amount: { amount: number; currency: string };
  receivedAmount: unknown;
  bonus: unknown;
  payee: string | null;
  startDate: string;
  endDate: string | null;
};
function checkRule(body: RuleShape, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: "custom", path: [path], message });
  if (body.kind === "expense" && body.amount.amount >= 0)
    issue("amount", "Expenses must be negative.");
  if (body.kind === "income" && body.amount.amount <= 0)
    issue("amount", "Income must be positive.");
  if (body.kind === "transfer") {
    if (body.amount.amount <= 0) issue("amount", "Enter a positive amount.");
    if (!body.toAccountId)
      issue("toAccountId", "Choose the receiving account.");
    else if (body.toAccountId.toLowerCase() === body.accountId.toLowerCase())
      issue("toAccountId", "Choose two different accounts.");
    if (body.categoryId !== null)
      issue("categoryId", "Transfers have no category.");
    if (body.payee !== null) issue("payee", "Transfers have no payee.");
  } else {
    if (body.toAccountId !== null)
      issue("toAccountId", "Only transfers have a receiving account.");
    if (body.receivedAmount !== null)
      issue("receivedAmount", "Only transfers have a received amount.");
    if (body.bonus !== null) issue("bonus", "Only transfers have a bonus.");
  }
  if (body.endDate !== null && body.endDate < body.startDate)
    issue("endDate", "The end date cannot be before the start date.");
}
export const createRecurringRuleSchema = z
  .strictObject(ruleFields)
  .superRefine(checkRule);
export const updateRecurringRuleSchema = z
  .strictObject({ ...ruleFields, expectedVersion: versionSchema })
  .superRefine(checkRule);
export const recurringRuleVersionSchema = z.strictObject({
  expectedVersion: versionSchema,
});
export const recurringRuleParamsSchema = ledgerParamsSchema.extend({
  ruleId: idSchema,
});
export const recurringRunParamsSchema = ledgerParamsSchema.extend({
  runId: idSchema,
});
export const recurringRuleSchema = z.object({
  id: idSchema,
  ledgerId: idSchema,
  ...ruleFields,
  // The next occurrence still to be created; null once the rule has ended.
  nextDate: z.iso.date().nullable(),
  paused: z.boolean(),
  pausedReason: z.enum(["manual", "access"]).nullable(),
  // Occurrences that could not be created and are tried again (see the runs).
  needsAttention: z.number().int().min(0),
  version: versionSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const recurringRuleListSchema = z.object({
  items: z.array(recurringRuleSchema),
});
export const recurringRunSchema = z.object({
  id: idSchema,
  ruleId: idSchema,
  date: z.iso.date(),
  status: z.enum(["created", "skipped", "attention"]),
  // A fixed, non-sensitive sentence for an occurrence that needs attention.
  reason: z.string().nullable(),
  // What a created occurrence made: an entry, or a transfer (and its sending leg).
  transactionId: idSchema.nullable(),
  transferId: idSchema.nullable(),
  version: versionSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const recurringRunListSchema = z.object({
  items: z.array(recurringRunSchema),
});
export type RecurringRule = z.infer<typeof recurringRuleSchema>;
export type CreateRecurringRule = z.infer<typeof createRecurringRuleSchema>;
export type UpdateRecurringRule = z.infer<typeof updateRecurringRuleSchema>;
export type RecurringRun = z.infer<typeof recurringRunSchema>;
