import type { Account } from "@ledgerline/shared";
import { accountTypes, isLiability } from "./form";

/** A client's balance account (ADR 0030) is managed from Clients, so it is never listed here. */
export const ownAccounts = <T extends Pick<Account, "contactId">>(
  items: readonly T[],
) => items.filter((account) => !account.contactId);

export type AccountGroup<T> = {
  key: "liquid" | "debt";
  title: string;
  items: T[];
};

/**
 * The active accounts in two groups, money to hand first (the same split as Home), and the archived ones apart.
 * A group with nothing in it is left out.
 */
export function splitAccounts<
  T extends Pick<Account, "type" | "archivedAt" | "contactId">,
>(items: readonly T[]) {
  const own = ownAccounts(items);
  const active = own.filter((account) => !account.archivedAt);
  const groups: AccountGroup<T>[] = [
    {
      key: "liquid",
      title: "Cash and banking",
      items: active.filter((account) => !isLiability(account.type)),
    },
    {
      key: "debt",
      title: "Cards and loans",
      items: active.filter((account) => isLiability(account.type)),
    },
  ];
  return {
    groups: groups.filter((group) => group.items.length > 0),
    archived: own.filter((account) => account.archivedAt),
  };
}

/**
 * The one hint of a row: "Type · CUR", and what the balance means when it is not plain money to hand: a card
 * or loan below zero is what is owed, above zero a credit, and money to hand below zero is overdrawn.
 */
export function accountHint(
  account: Pick<Account, "type" | "currency" | "balance">,
) {
  const base = `${accountTypes[account.type]} · ${account.currency}`;
  const amount = account.balance.amount;
  if (amount === 0) return base;
  if (isLiability(account.type))
    return `${base} · ${amount < 0 ? "Owed" : "Credit"}`;
  return amount < 0 ? `${base} · Overdrawn` : base;
}

/** Money to hand below zero is the only red figure on the page. */
export const isOverdrawn = (account: Pick<Account, "type" | "balance">) =>
  !isLiability(account.type) && account.balance.amount < 0;
