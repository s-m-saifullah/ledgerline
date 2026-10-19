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

  it("turns the one Fee box into a fixed fee or a percentage, only on transfers", () => {
    const fees = newId();
    const transfer = {
      kind: "transfer" as const,
      toAccountId: savings.id,
      categoryId: "",
      amount: "50",
    };
    expect(body(transfer).fee).toBeNull();
    expect(
      body({ ...transfer, feeText: "2", feeCategoryId: fees }).fee,
    ).toEqual({ amount: { amount: 200, currency: "USD" }, categoryId: fees });
    expect(
      body({ ...transfer, feeText: "1.5%", feeCategoryId: fees }).fee,
    ).toEqual({ basisPoints: 150, categoryId: fees });
    // The box is ignored once the rule is not a transfer.
    expect(body({ feeText: "2", feeCategoryId: fees }).fee).toBeNull();
  });

  it("explains a fee that is mistyped, has no category or comes to nothing", () => {
    const transfer = {
      kind: "transfer" as const,
      toAccountId: savings.id,
      categoryId: "",
      amount: "50",
    };
    expect(errors({ ...transfer, feeText: "abc" }).feeText).toMatch(/2%/);
    expect(errors({ ...transfer, feeText: "2" }).feeCategoryId).toMatch(
      /expense category/,
    );
    expect(
      errors({
        ...transfer,
        amount: "0.40",
        feeText: "0.01%",
        feeCategoryId: "x",
      }).feeText,
    ).toMatch(/smallest unit/);
    expect(errors({ ...transfer }).feeText).toBeUndefined();
  });

  it("shows a saved fee the way it was typed", () => {
    const fees = newId();
    const rule = (fee: unknown) =>
      valuesFromRule({
        title: "Remit",
        kind: "transfer",
        accountId: usd.id,
        toAccountId: savings.id,
        categoryId: null,
        amount: { amount: 5000, currency: "USD" },
        receivedAmount: null,
        bonus: null,
        fee,
        payee: null,
        note: null,
        frequency: "month",
        interval: 1,
        startDate: "2026-11-01",
        endDate: null,
      } as never);
    expect(rule({ basisPoints: 250, categoryId: fees })).toMatchObject({
      feeText: "2.5%",
      feeCategoryId: fees,
    });
    expect(
      rule({ amount: { amount: 200, currency: "USD" }, categoryId: fees }),
    ).toMatchObject({ feeText: "2.00", feeCategoryId: fees });
    expect(rule(null)).toMatchObject({ feeText: "", feeCategoryId: "" });
  });
});

describe("recurring form tags", () => {
  it("sends the chosen tags with the rule and reads them back", () => {
    const tag = newId();
    expect(body({ tagIds: [tag] }).tagIds).toEqual([tag]);
    expect(body().tagIds).toEqual([]);
    expect(
      valuesFromRule({ ...body({ tagIds: [tag] }), id: newId() } as never)
        .tagIds,
    ).toEqual([tag]);
  });
});
