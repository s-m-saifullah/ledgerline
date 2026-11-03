import { type LoanBalance, type LoanPerson, newId } from "@ledgerline/shared";
import { describe, expect, it } from "vitest";
import {
  activityWord,
  anyArchived,
  cardLabel,
  isOpenPerson,
  openLoans,
  personRow,
  resolveFilter,
  SEARCH_FROM,
  showsSearch,
  sortPeople,
  visiblePeople,
} from "./model";

const loan = (amount: number, currency = "USD"): LoanBalance => ({
  accountId: newId(),
  currency,
  openingBalance: { amount: 0, currency },
  balance: { amount, currency },
  version: 1,
});
const person = (
  name: string,
  balances: LoanBalance[] = [],
  archived = false,
): LoanPerson => ({
  id: newId(),
  name,
  origin: "loan",
  archivedAt: archived ? "2026-10-01T00:00:00.000Z" : null,
  version: 1,
  balances,
});
const names = (people: readonly LoanPerson[]) => people.map((p) => p.name);

describe("who has something open", () => {
  it("counts a balance in any currency, either way, and ignores a settled one", () => {
    expect(openLoans([loan(0), loan(-5, "EUR"), loan(7, "GBP")])).toHaveLength(
      2,
    );
    expect(isOpenPerson(person("A", [loan(0)]))).toBe(false);
    expect(isOpenPerson(person("A", []))).toBe(false);
    expect(isOpenPerson(person("A", [loan(-1)]))).toBe(true);
  });
});

describe("sorting and filtering the people", () => {
  const people = [
    person("Zed", [loan(100)]),
    person("Amy"),
    person("Bob", [loan(-50)]),
    person("Old", [loan(10)], true),
  ];
  it("puts people with something open first, then by name", () => {
    expect(names(sortPeople(people))).toEqual(["Bob", "Old", "Zed", "Amy"]);
  });
  it("does not change the list it is given", () => {
    const copy = [...people];
    sortPeople(people);
    expect(people).toEqual(copy);
  });
  it("Active is everyone not archived, settled or not; Archived is the others; All is everyone", () => {
    expect(names(visiblePeople(people, "active", ""))).toEqual([
      "Bob",
      "Zed",
      "Amy",
    ]);
    expect(names(visiblePeople(people, "archived", ""))).toEqual(["Old"]);
    expect(names(visiblePeople(people, "all", ""))).toHaveLength(4);
  });
  it("searches names by any part, whatever the case, and with spaces around it", () => {
    expect(names(visiblePeople(people, "all", "  AM "))).toEqual(["Amy"]);
    expect(names(visiblePeople(people, "all", "o"))).toEqual(["Bob", "Old"]);
    expect(visiblePeople(people, "all", "zzz")).toEqual([]);
  });
  it("applies the chip and the search together", () => {
    expect(names(visiblePeople(people, "active", "o"))).toEqual(["Bob"]);
  });
});

describe("the chips", () => {
  it("are for a list with someone archived", () => {
    expect(anyArchived([person("A")])).toBe(false);
    expect(anyArchived([person("A"), person("B", [], true)])).toBe(true);
  });
  it("fall back to Active when the chosen one means nothing", () => {
    const none = [person("A")];
    const some = [person("A"), person("B", [], true)];
    expect(resolveFilter(null, some)).toBe("active");
    expect(resolveFilter("archived", none)).toBe("active");
    expect(resolveFilter("all", none)).toBe("active");
    expect(resolveFilter("archived", some)).toBe("archived");
    expect(resolveFilter("all", some)).toBe("all");
    expect(resolveFilter("active", some)).toBe("active");
  });
});

describe("search", () => {
  it("shows from eight people, not before", () => {
    const some = (n: number) =>
      Array.from({ length: n }, (_, i) => person(`P${i}`));
    expect(SEARCH_FROM).toBe(8);
    expect(showsSearch(some(7))).toBe(false);
    expect(showsSearch(some(8))).toBe(true);
    expect(showsSearch(some(0))).toBe(false);
  });
});

describe("a row", () => {
  it("says who owes whom and shows the amount", () => {
    expect(personRow(person("A", [loan(1250)]))).toEqual({
      hint: "Owes you",
      amount: { cents: 1250, currency: "USD" },
      owedToYou: true,
    });
    expect(personRow(person("A", [loan(-300, "EUR")]))).toEqual({
      hint: "You owe",
      amount: { cents: 300, currency: "EUR" },
      owedToYou: false,
    });
  });
  it("says Settled, No loans yet or Archived, with no amount for the first two", () => {
    expect(personRow(person("A", [loan(0)]))).toMatchObject({
      hint: "Settled",
      amount: null,
    });
    expect(personRow(person("A", []))).toMatchObject({
      hint: "No loans yet",
      amount: null,
    });
    expect(personRow(person("A", [loan(0)], true)).hint).toBe("Archived");
  });
  it("keeps Archived as the hint even with money open, and still shows the amount", () => {
    const row = personRow(person("A", [loan(500)], true));
    expect(row.hint).toBe("Archived");
    expect(row.amount).toEqual({ cents: 500, currency: "USD" });
  });
  it("skips a settled currency and counts the others as more", () => {
    const row = personRow(
      person("A", [loan(0, "GBP"), loan(-200, "EUR"), loan(900, "USD")]),
    );
    expect(row.hint).toBe("You owe · +1 more");
    expect(row.amount).toEqual({ cents: 200, currency: "EUR" });
    expect(
      personRow(person("A", [loan(1), loan(2, "EUR"), loan(3, "GBP")])).hint,
    ).toBe("Owes you · +2 more");
  });
});

describe("the card's label", () => {
  it("is one direction when every open balance agrees, a neutral word when they differ", () => {
    expect(cardLabel([])).toBe("Settled");
    expect(cardLabel([loan(0)])).toBe("Settled");
    expect(cardLabel([loan(5), loan(0, "EUR")])).toBe("Owes you");
    expect(cardLabel([loan(-5), loan(-1, "EUR")])).toBe("You owe");
    expect(cardLabel([loan(5), loan(-1, "EUR")])).toBe("Open balances");
  });
});

describe("activity", () => {
  it("names a transfer by its direction and an expense or income as waived", () => {
    expect(activityWord({ kind: "transfer", amount: { amount: 100 } })).toBe(
      "You paid out",
    );
    expect(activityWord({ kind: "transfer", amount: { amount: -100 } })).toBe(
      "You received",
    );
    expect(activityWord({ kind: "expense", amount: { amount: -100 } })).toBe(
      "You waived",
    );
    expect(activityWord({ kind: "income", amount: { amount: 100 } })).toBe(
      "They waived",
    );
  });
});
