import {
  type CreateRecurringRule,
  type RecurringRule,
  type RecurringRun,
  recurringRuleListSchema,
  recurringRuleSchema,
  recurringRunListSchema,
  recurringRunSchema,
} from "@ledgerline/shared";
import { api, prepareFinancialWrite } from "../../lib/api";

const path = (ledgerId: string) => `/ledgers/${ledgerId}/recurring-rules`;
export async function getRules(
  ledgerId: string,
  signal?: AbortSignal,
): Promise<RecurringRule[]> {
  return recurringRuleListSchema.parse(
    await api(path(ledgerId), { ...(signal ? { signal } : {}) }),
  ).items;
}
export async function getRuns(
  ledgerId: string,
  ruleId: string,
  signal?: AbortSignal,
): Promise<RecurringRun[]> {
  return recurringRunListSchema.parse(
    await api(`${path(ledgerId)}/${ruleId}/runs`, {
      ...(signal ? { signal } : {}),
    }),
  ).items;
}
export function prepareRuleCreate(ledgerId: string, body: CreateRecurringRule) {
  const run = prepareFinancialWrite<unknown>(path(ledgerId), "POST", body);
  return async () => recurringRuleSchema.parse(await run());
}
export function prepareRuleUpdate(
  ledgerId: string,
  rule: RecurringRule,
  body: CreateRecurringRule,
) {
  const run = prepareFinancialWrite<unknown>(
    `${path(ledgerId)}/${rule.id}`,
    "PATCH",
    { ...body, expectedVersion: rule.version },
  );
  return async () => recurringRuleSchema.parse(await run());
}
export function prepareRuleToggle(
  ledgerId: string,
  rule: RecurringRule,
  action: "pause" | "resume",
) {
  const run = prepareFinancialWrite<unknown>(
    `${path(ledgerId)}/${rule.id}/${action}`,
    "POST",
    { expectedVersion: rule.version },
  );
  return async () => recurringRuleSchema.parse(await run());
}
export function prepareRuleDelete(ledgerId: string, rule: RecurringRule) {
  return prepareFinancialWrite<undefined>(
    `${path(ledgerId)}/${rule.id}`,
    "DELETE",
    { expectedVersion: rule.version },
  );
}
export function prepareRunSkip(ledgerId: string, run: RecurringRun) {
  const write = prepareFinancialWrite<unknown>(
    `/ledgers/${ledgerId}/recurring-runs/${run.id}/skip`,
    "POST",
    { expectedVersion: run.version },
  );
  return async () => recurringRunSchema.parse(await write());
}
