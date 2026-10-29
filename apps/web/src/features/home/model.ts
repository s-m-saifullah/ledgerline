import type { Account } from "@ledgerline/shared";
import { type LimitState, limitState } from "@ledgerline/ui";

type Listed = Pick<
  Account,
  "id" | "type" | "currency" | "contactId" | "balance"
>;

/** Cards and loans are what the owner owes; bank, cash, wallet and savings are money to hand. */
const isDebt = (type: Account["type"]) => type === "card" || type === "loan";
/** A client's balance account is managed from Clients, as on the Accounts page. */
const isOwn = (account: Pick<Account, "contactId">) => !account.contactId;

/** This month's money in against money out, as on the phone: the net, how much of the money in went out, and whether that is too much. */
export function cashFlow(
  moneyIn: number,
  moneyOut: number,
): { net: number; share: number; state: LimitState } {
  const net = moneyIn - moneyOut;
  if (moneyIn <= 0)
    return moneyOut > 0
      ? { net, share: 1, state: "over" }
      : { net, share: 0, state: "within" };
  return {
    net,
    share: Math.min(1, Math.max(0, moneyOut / moneyIn)),
    state: limitState(moneyOut, moneyIn),
  };
}

export type HeroFigureModel = {
  key: "clients" | "lent" | "borrowed";
  label: string;
  to: "/clients" | "/loans";
  amount: number;
};
type Usd = { amount: number };
/** The small figures under In hand. The web keeps money owed apart and names it by who owes it (ADR 0047). A figure of nothing is left out. */
export function heroFigures(
  owed: Usd,
  lent: Usd,
  borrowed: Usd,
): HeroFigureModel[] {
  const all: HeroFigureModel[] = [
    {
      key: "clients",
      label: "Clients owe",
      to: "/clients",
      amount: owed.amount,
    },
    { key: "lent", label: "People owe", to: "/loans", amount: lent.amount },
    {
      key: "borrowed",
      label: "You owe",
      to: "/loans",
      amount: borrowed.amount,
    },
  ];
  return all.filter((figure) => figure.amount > 0);
}

export type AccountGroup<T extends Listed> = {
  key: "liquid" | "debt";
  title: string;
  items: T[];
};
/** The accounts of `currency` (all when null) in two groups, money to hand first; a group with nothing in it is left out. */
export function accountGroups<T extends Listed>(
  accounts: readonly T[],
  currency: string | null,
): AccountGroup<T>[] {
  const shown = accounts.filter(
    (account) =>
      isOwn(account) && (currency === null || account.currency === currency),
  );
  const groups: AccountGroup<T>[] = [
    {
      key: "liquid",
      title: "Cash and banking",
      items: shown.filter((account) => !isDebt(account.type)),
    },
    {
      key: "debt",
      title: "Cards and loans",
      items: shown.filter((account) => isDebt(account.type)),
    },
  ];
  return groups.filter((group) => group.items.length > 0);
}

/** The currencies of the accounts, the one with most accounts first; the currency control shows only with two or more. */
export function currenciesOf(accounts: readonly Listed[]): string[] {
  const counts = new Map<string, number>();
  for (const account of accounts.filter(isOwn))
    counts.set(account.currency, (counts.get(account.currency) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([code]) => code);
}

/** Overdrawn is about money to hand: a card or loan below zero is just what is owed. */
export const isOverdrawn = (account: Listed) =>
  !isDebt(account.type) && account.balance.amount < 0;

/** "Oct 28" in the current year, "Dec 31, 2025" in another (the date of a row in a narrow list). */
export function shortDay(date: string, today = new Date()) {
  const [year, month, day] = date.split("-").map(Number);
  const local = new Date(0);
  local.setFullYear(year ?? 1, (month ?? 1) - 1, day ?? 1);
  local.setHours(12, 0, 0, 0);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(year === today.getFullYear() ? {} : { year: "numeric" }),
  }).format(local);
}
