import type { Account } from "@ledgerline/shared";
import { expect, it } from "vitest";
import { accountHint, isOverdrawn, ownAccounts, splitAccounts } from "./model";

type Row = Pick<
  Account,
  "type" | "currency" | "balance" | "archivedAt" | "contactId"
> & { name: string };
const row = (
  name: string,
  type: Account["type"],
  amount = 0,
  extra: Partial<Row> = {},
): Row => ({
  name,
  type,
  currency: "USD",
  balance: { amount, currency: "USD" },
  archivedAt: null,
  contactId: null,
  ...extra,
});

it("puts bank, cash, wallet and savings under Cash and banking, and cards and loans under Cards and loans", () => {
  const { groups } = splitAccounts([
    row("a", "bank"),
    row("b", "card"),
    row("c", "cash"),
    row("d", "loan"),
    row("e", "wallet"),
    row("f", "savings"),
  ]);
  expect(groups.map((group) => group.title)).toEqual([
    "Cash and banking",
    "Cards and loans",
  ]);
  expect(groups[0]?.items.map((item) => item.name)).toEqual([
    "a",
    "c",
    "e",
    "f",
  ]);
  expect(groups[1]?.items.map((item) => item.name)).toEqual(["b", "d"]);
});
it("leaves out a group with nothing in it", () => {
  expect(splitAccounts([row("a", "bank")]).groups.map((g) => g.key)).toEqual([
    "liquid",
  ]);
  expect(splitAccounts([row("a", "card")]).groups.map((g) => g.key)).toEqual([
    "debt",
  ]);
  expect(splitAccounts([]).groups).toEqual([]);
});
it("lists archived accounts apart, never in a group", () => {
  const gone = row("old", "savings", 0, { archivedAt: "2026-10-07T00:00:00Z" });
  const { groups, archived } = splitAccounts([row("a", "bank"), gone]);
  expect(archived).toEqual([gone]);
  expect(groups.flatMap((group) => group.items)).not.toContain(gone);
});
it("never lists a client's balance account", () => {
  const client = row("Ada", "bank", 0, { contactId: "x" });
  const own = row("a", "bank");
  expect(ownAccounts([client, own])).toEqual([own]);
  const { groups, archived } = splitAccounts([
    client,
    { ...client, archivedAt: "2026-10-07T00:00:00Z" },
    own,
  ]);
  expect(groups.flatMap((group) => group.items)).toEqual([own]);
  expect(archived).toEqual([]);
});
it("says what a balance means in the one hint", () => {
  expect(accountHint(row("a", "bank", 5000))).toBe("Bank account · USD");
  expect(accountHint(row("a", "bank", 0))).toBe("Bank account · USD");
  expect(accountHint(row("a", "bank", -5000))).toBe(
    "Bank account · USD · Overdrawn",
  );
  expect(accountHint(row("a", "card", -5000))).toBe("Credit card · USD · Owed");
  expect(accountHint(row("a", "loan", 5000))).toBe("Loan · USD · Credit");
  expect(accountHint(row("a", "card", 0))).toBe("Credit card · USD");
  expect(accountHint({ ...row("a", "cash", 1), currency: "EUR" })).toBe(
    "Cash · EUR",
  );
});
it("calls only money to hand below zero overdrawn", () => {
  expect(isOverdrawn(row("a", "bank", -1))).toBe(true);
  expect(isOverdrawn(row("a", "bank", 0))).toBe(false);
  expect(isOverdrawn(row("a", "card", -1))).toBe(false);
});
