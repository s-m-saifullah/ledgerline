import type { LoanBalance, LoanPerson } from "@ledgerline/shared";

/** The chips above the list (ADR 0047): everyone not archived, the archived ones, or all. */
export type PeopleFilter = "active" | "archived" | "all";

/** Search appears once there are this many people (ADR 0047: "search only from eight people"). */
export const SEARCH_FROM = 8;

/** The currencies in which money is still owed either way. */
export const openLoans = (balances: readonly LoanBalance[]) =>
  balances.filter((loan) => loan.balance.amount !== 0);

export const isOpenPerson = (person: LoanPerson) =>
  openLoans(person.balances).length > 0;

/** Who owes whom in one currency, for a row or a card (a positive balance is money owed to you). */
export const owesWord = (loan: LoanBalance) =>
  loan.balance.amount > 0 ? "Owes you" : "You owe";

/** People with something open first, then by name. */
export function sortPeople(people: readonly LoanPerson[]) {
  return [...people].sort(
    (a, b) =>
      Number(isOpenPerson(b)) - Number(isOpenPerson(a)) ||
      a.name.localeCompare(b.name),
  );
}

const inFilter = (person: LoanPerson, filter: PeopleFilter) =>
  filter === "all" || (filter === "archived") === !!person.archivedAt;

export const personMatches = (person: LoanPerson, text: string) =>
  person.name.toLowerCase().includes(text.trim().toLowerCase());

export function visiblePeople(
  people: readonly LoanPerson[],
  filter: PeopleFilter,
  text: string,
) {
  return sortPeople(people).filter(
    (person) => inFilter(person, filter) && personMatches(person, text),
  );
}

export const anyArchived = (people: readonly LoanPerson[]) =>
  people.some((person) => person.archivedAt);

/** The chip the owner chose; Archived and All mean nothing once nobody is archived, so Active stands. */
export function resolveFilter(
  chosen: PeopleFilter | null,
  people: readonly LoanPerson[],
): PeopleFilter {
  if (!chosen || (chosen !== "active" && !anyArchived(people))) return "active";
  return chosen;
}

/** The search box is for a longer list. */
export const showsSearch = (people: readonly LoanPerson[]) =>
  people.length >= SEARCH_FROM;

/**
 * A list row's one hint and its figure: who owes whom, with "+1 more" when a second currency is open, and the
 * first open currency's amount (there is no single worth in dollars to add them up).
 */
export function personRow(person: LoanPerson) {
  const open = openLoans(person.balances);
  const first = open[0];
  const more = open.length > 1 ? ` · +${open.length - 1} more` : "";
  const hint = person.archivedAt
    ? "Archived"
    : first
      ? `${owesWord(first)}${more}`
      : person.balances.length === 0
        ? "No loans yet"
        : "Settled";
  return {
    hint,
    amount: first
      ? { cents: Math.abs(first.balance.amount), currency: first.currency }
      : null,
    owedToYou: !!first && first.balance.amount > 0,
  };
}

/** The label above a person's figure: one direction when every open balance agrees, otherwise a neutral word. */
export function cardLabel(balances: readonly LoanBalance[]) {
  const open = openLoans(balances);
  if (open.length === 0) return "Settled";
  if (open.every((loan) => loan.balance.amount > 0)) return "Owes you";
  if (open.every((loan) => loan.balance.amount < 0)) return "You owe";
  return "Open balances";
}

/** What a kind of entry on a loan account means to you. */
export function activityWord(entry: {
  kind: string;
  amount: { amount: number };
}) {
  return entry.kind === "transfer"
    ? entry.amount.amount > 0
      ? "You paid out"
      : "You received"
    : entry.kind === "expense"
      ? "You waived"
      : "They waived";
}
