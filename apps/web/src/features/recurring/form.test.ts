import { type Account, newId } from "@ledgerline/shared";
import { describe, expect, it } from "vitest";
import {
  type RuleFormValues,
  ruleBody,
  ruleDefaults,
  valuesFromRule,
} from "./form";

const account = (currency: string, extra: Partial<Account> = {}): Account =>
  ({ id: newId(), currency, archivedAt: null, ...extra }) as Account;
const usd = account("USD");
const savings = account("USD");
const wallet = account("BDT");
const accounts = [usd, savings, wallet];
const category = newId();
const values = (extra: Partial<RuleFormValues> = {}): RuleFormValues => ({
  ...ruleDefaults(accounts, "2026-11-01"),
  title: "Rent",
  accountId: usd.id,
  categoryId: category,
  amount: "1,200.50",
  startDate: "2026-11-01",
  ...extra,
});
const body = (extra: Partial<RuleFormValues> = {}) => {
  const result = ruleBody(values(extra), accounts);
  if (!("body" in result)) throw new Error(JSON.stringify(result.errors));
  return result.body;
};
const errors = (extra: Partial<RuleFormValues> = {}) => {
  const result = ruleBody(values(extra), accounts);
  return "errors" in result ? result.errors : {};
};

describe("recurring form", () => {
  it("defaults to a monthly expense from the first active account", () => {
    const defaults = ruleDefaults(
      [account("USD", { archivedAt: "2026-01-01T00:00:00.000Z" }), usd],
      "2026-11-01",
    );
    expect(defaults).toMatchObject({
      kind: "expense",
      accountId: usd.id,
      frequency: "month",
      interval: "1",
      startDate: "2026-11-01",
    });
  });

  it("makes an expense negative and an income positive, in the account's units", () => {
    expect(body().amount).toEqual({ amount: -120050, currency: "USD" });
    expect(body({ kind: "income" }).amount).toEqual({
      amount: 120050,
      currency: "USD",
    });
    expect(body({ accountId: wallet.id, amount: "500" }).amount).toEqual({
      amount: -50000,
      currency: "BDT",
    });
  });

  it("builds a transfer with an amount that arrives and an explicit bonus", () => {
    const made = body({
      kind: "transfer",
      toAccountId: wallet.id,
      categoryId: "",
      payee: "Ignored",
      amount: "100",
      receivedAmount: "12,000",
      bonusOn: true,
      bonusAmount: "300",
      bonusCategoryId: category,
    });
    expect(made).toMatchObject({
      kind: "transfer",
      categoryId: null,
      payee: null,
      amount: { amount: 10000, currency: "USD" },
      receivedAmount: { amount: 1200000, currency: "BDT" },
      bonus: {
        amount: { amount: 30000, currency: "BDT" },
        categoryId: category,
      },
    });
    expect(
      body({
        kind: "transfer",
        toAccountId: savings.id,
        categoryId: "",
        amount: "5",
      }).receivedAmount,
    ).toBeNull();
  });

  it("asks for what is missing", () => {
    expect(errors({ title: " " }).title).toBeTruthy();
    expect(errors({ amount: "abc" }).amount).toBeTruthy();
    expect(errors({ categoryId: "" }).categoryId).toBeTruthy();
    expect(errors({ interval: "0" }).interval).toBeTruthy();
    expect(errors({ endDate: "2026-10-01" }).endDate).toBeTruthy();
    const transfer = { kind: "transfer" as const, categoryId: "", amount: "5" };
    expect(errors({ ...transfer, toAccountId: "" }).toAccountId).toBeTruthy();
    expect(
      errors({ ...transfer, toAccountId: usd.id }).toAccountId,
    ).toBeTruthy();
    expect(
      errors({ ...transfer, toAccountId: wallet.id }).receivedAmount,
    ).toBeTruthy();
    expect(
      errors({ ...transfer, toAccountId: savings.id, bonusOn: true })
        .bonusAmount,
    ).toBeTruthy();
  });

  it("fills the form back in from a saved rule", () => {
    const original = body({
      kind: "transfer",
      toAccountId: wallet.id,
      categoryId: "",
      amount: "100",
      receivedAmount: "12000",
      endDate: "2027-01-01",
    });
    const rule = {
      ...original,
      id: newId(),
      ledgerId: newId(),
      nextDate: "2026-11-01",
      paused: false,
      pausedReason: null,
      needsAttention: 0,
      version: 1,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    expect(valuesFromRule(rule)).toMatchObject({
      kind: "transfer",
      amount: "100.00",
      receivedAmount: "12000.00",
      endDate: "2027-01-01",
      interval: "1",
    });
    expect(ruleBody(valuesFromRule(rule), accounts)).toEqual({
      body: original,
    });
  });
});
