import { type Account, newId } from "@ledgerline/shared";
import { afterEach, expect, it } from "vitest";
import {
  lastActiveAccount,
  localToday,
  rememberAccount,
  transactionBody,
  transactionDefaults,
  transactionFormSchema,
} from "./form";

const ledgerId = newId(),
  actorId = newId();
const account = (name: string, archivedAt: string | null = null) =>
  ({ id: newId(), ledgerId, name, archivedAt }) as Account;
afterEach(() => localStorage.clear());
it("uses local calendar fields without converting the date to UTC", () => {
  expect(localToday(new Date(2026, 9, 7, 23, 55))).toBe("2026-10-07");
});
it("parses positive input exactly and applies expense/income signs", () => {
  const base = {
    ...transactionDefaults(actorId, ledgerId, [account("Bank")]),
    amount: "90071992547409.91",
    categoryId: newId(),
  };
  expect(transactionBody(base).amount.amount).toBe(Number.MIN_SAFE_INTEGER);
  expect(transactionBody({ ...base, kind: "income" }).amount.amount).toBe(
    Number.MAX_SAFE_INTEGER,
  );
  for (const amount of ["0", "-1", "1.001", "90071992547409.92", "1e2"])
    expect(transactionFormSchema.safeParse({ ...base, amount }).success).toBe(
      false,
    );
});
it("scopes the last-used account to actor and ledger and falls back from archives", () => {
  const bank = account("Bank"),
    cash = account("Cash"),
    archived = account("Archive", "2026-10-07T00:00:00Z");
  rememberAccount(actorId, ledgerId, cash.id);
  expect(lastActiveAccount(actorId, ledgerId, [bank, cash])).toBe(cash.id);
  expect(lastActiveAccount(newId(), ledgerId, [bank, cash])).toBe(bank.id);
  expect(lastActiveAccount(actorId, newId(), [bank, cash])).toBe(bank.id);
  rememberAccount(actorId, ledgerId, archived.id);
  expect(lastActiveAccount(actorId, ledgerId, [archived, bank])).toBe(bank.id);
  expect(lastActiveAccount(actorId, ledgerId, [archived])).toBe("");
});

it("keeps optional local time exact and sends a blank time as null", () => {
  const values = {
    ...transactionDefaults(actorId, ledgerId, [account("Bank")]),
    amount: "1.23",
    categoryId: newId(),
  };
  expect(transactionBody(values).time).toBeNull();
  expect(transactionBody({ ...values, time: "23:59" }).time).toBe("23:59");
  expect(
    transactionFormSchema.safeParse({ ...values, time: "24:00" }).success,
  ).toBe(false);
});

it("parses split decimals exactly, preserves saved line IDs and applies one direction", () => {
  const id = newId();
  const values = {
    ...transactionDefaults(actorId, ledgerId, [account("Bank")]),
    amount: "0.29",
    splitEnabled: true,
    splits: [
      { id, categoryId: newId(), amount: "0.10", note: "First" },
      { categoryId: newId(), amount: "0.19", note: "" },
    ],
  };
  const body = transactionBody(values);
  expect(body.categoryId).toBeNull();
  expect(body.splits?.map((line) => line.amount.amount)).toEqual([-10, -19]);
  expect(body.splits?.[0]?.id).toBe(id);
  expect(
    transactionBody({ ...values, kind: "income" }).splits?.map(
      (line) => line.amount.amount,
    ),
  ).toEqual([10, 19]);
});
it("keeps incomplete and mismatched split drafts correctable and omits split fields for ordinary saves", () => {
  const values = {
    ...transactionDefaults(actorId, ledgerId, [account("Bank")]),
    amount: "0.29",
    categoryId: newId(),
    splitEnabled: true,
    splits: [
      { categoryId: newId(), amount: "0.10", note: "" },
      { categoryId: newId(), amount: "0.18", note: "" },
    ],
  };
  expect(transactionFormSchema.safeParse(values).success).toBe(false);
  expect(
    transactionFormSchema.safeParse({
      ...values,
      splits: [{ categoryId: "", amount: "0.10", note: "" }, values.splits[1]],
    }).success,
  ).toBe(false);
  expect(
    transactionBody({ ...values, splitEnabled: false }),
  ).not.toHaveProperty("splits");
});

it("accepts typed amounts like $1,200.50 and .50 and still rejects unclear ones", () => {
  const base = {
    ...transactionDefaults(actorId, ledgerId, [account("Bank")]),
    categoryId: newId(),
  };
  for (const [typed, cents] of [
    ["$1,200.50", 120050],
    [".50", 50],
    ["5.", 500],
    [" 7 ", 700],
  ] as const)
    expect(transactionBody({ ...base, amount: typed }).amount.amount).toBe(
      -cents,
    );
  for (const bad of ["1,20", "0", "-5", "1.234", "abc", ""])
    expect(
      transactionFormSchema.safeParse({ ...base, amount: bad }).success,
    ).toBe(false);
});
