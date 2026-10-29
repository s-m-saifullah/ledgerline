import type { Account } from "@ledgerline/shared";
import { describe, expect, it } from "vitest";
import {
  accountGroups,
  cashFlow,
  currenciesOf,
  heroFigures,
  isOverdrawn,
  shortDay,
} from "./model";

const usd = (amount: number) => ({ amount, currency: "USD" });
function account(
  over: Partial<Pick<Account, "type" | "currency" | "contactId">> & {
    id?: string;
    balance?: number;
    name?: string;
  } = {},
) {
  const currency = over.currency ?? "USD";
  return {
    id: over.id ?? "a",
    name: over.name ?? "Checking",
    type: over.type ?? "bank",
    currency,
    contactId: over.contactId ?? null,
    balance: { amount: over.balance ?? 100, currency },
  };
}

describe("cashFlow (the phone's rule)", () => {
  it("is the net, the share of the money in that went out, and the state", () => {
    expect(cashFlow(1000, 400)).toEqual({
      net: 600,
      share: 0.4,
      state: "within",
    });
  });
  it("warns at 90 per cent and is over above 100", () => {
    expect(cashFlow(1000, 900).state).toBe("near");
    expect(cashFlow(1000, 899).state).toBe("within");
    expect(cashFlow(1000, 1001).state).toBe("over");
  });
  it("fills the bar no more than full", () => {
    expect(cashFlow(1000, 5000).share).toBe(1);
  });
  it("with nothing in, anything out is over and a bare month is empty", () => {
    expect(cashFlow(0, 500)).toEqual({ net: -500, share: 1, state: "over" });
    expect(cashFlow(0, 0)).toEqual({ net: 0, share: 0, state: "within" });
  });
});

describe("heroFigures", () => {
  it("lists Clients owe, People owe and You owe, each linking to its page", () => {
    expect(heroFigures(usd(500), usd(300), usd(200))).toEqual([
      { key: "clients", label: "Clients owe", to: "/clients", amount: 500 },
      { key: "lent", label: "People owe", to: "/loans", amount: 300 },
      { key: "borrowed", label: "You owe", to: "/loans", amount: 200 },
    ]);
  });
  it("leaves out each figure that is zero, on its own", () => {
    expect(heroFigures(usd(0), usd(300), usd(0)).map((f) => f.key)).toEqual([
      "lent",
    ]);
    expect(heroFigures(usd(500), usd(0), usd(200)).map((f) => f.key)).toEqual([
      "clients",
      "borrowed",
    ]);
    expect(heroFigures(usd(0), usd(0), usd(0))).toEqual([]);
  });
});

describe("account groups", () => {
  it("puts bank, cash, wallet and savings in Cash and banking, and cards and loans in Cards and loans", () => {
    const groups = accountGroups(
      [
        account({ id: "1", type: "bank" }),
        account({ id: "2", type: "card" }),
        account({ id: "3", type: "wallet" }),
        account({ id: "4", type: "loan" }),
        account({ id: "5", type: "savings" }),
        account({ id: "6", type: "cash" }),
      ] as Account[],
      null,
    );
    expect(groups.map((g) => [g.title, g.items.map((a) => a.id)])).toEqual([
      ["Cash and banking", ["1", "3", "5", "6"]],
      ["Cards and loans", ["2", "4"]],
    ]);
  });
  it("leaves out a group with nothing in it", () => {
    const groups = accountGroups(
      [account({ type: "card" })] as Account[],
      null,
    );
    expect(groups.map((g) => g.title)).toEqual(["Cards and loans"]);
  });
  it("leaves out a client's balance account", () => {
    expect(
      accountGroups([account({ contactId: "c1" })] as Account[], null),
    ).toEqual([]);
  });
  it("shows only the chosen currency", () => {
    const groups = accountGroups(
      [
        account({ id: "u", currency: "USD" }),
        account({ id: "e", currency: "EUR" }),
      ] as Account[],
      "EUR",
    );
    expect(groups[0]?.items.map((a) => a.id)).toEqual(["e"]);
  });
});

describe("currenciesOf", () => {
  it("lists each currency once, the one with most accounts first, then by code", () => {
    const list = [
      account({ currency: "EUR" }),
      account({ currency: "USD" }),
      account({ currency: "USD" }),
      account({ currency: "BDT" }),
    ] as Account[];
    expect(currenciesOf(list)).toEqual(["USD", "BDT", "EUR"]);
  });
  it("does not count a client's balance account", () => {
    expect(
      currenciesOf([
        account({ currency: "USD" }),
        account({ currency: "EUR", contactId: "c1" }),
      ] as Account[]),
    ).toEqual(["USD"]);
  });
});

describe("isOverdrawn", () => {
  it("is true only for money to hand below zero", () => {
    expect(isOverdrawn(account({ type: "bank", balance: -1 }) as Account)).toBe(
      true,
    );
    expect(isOverdrawn(account({ type: "bank", balance: 0 }) as Account)).toBe(
      false,
    );
    expect(
      isOverdrawn(account({ type: "card", balance: -1000 }) as Account),
    ).toBe(false);
    expect(
      isOverdrawn(account({ type: "loan", balance: -1000 }) as Account),
    ).toBe(false);
  });
});

describe("shortDay", () => {
  const today = new Date(2026, 9, 29);
  it("is the month and day, without the year, in the current year", () => {
    expect(shortDay("2026-10-28", today)).toBe("Oct 28");
    expect(shortDay("2026-01-05", today)).toBe("Jan 5");
  });
  it("adds the year for another year", () => {
    expect(shortDay("2025-12-31", today)).toBe("Dec 31, 2025");
  });
});
