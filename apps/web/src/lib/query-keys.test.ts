import { describe, expect, it } from "vitest";
import { ledgerAreas, queryKeys } from "./query-keys";

const L = "ledger-1";

/** Every ledger key the app builds, with sample arguments. */
const ledgerKeys = {
  ledger: queryKeys.ledger(L),
  accounts: queryKeys.accounts(L),
  activeAccounts: queryKeys.activeAccounts(L),
  allAccounts: queryKeys.allAccounts(L),
  accountPages: queryKeys.accountPages(L),
  categories: queryKeys.categories(L),
  home: queryKeys.home(L, "2026-11"),
  transactions: queryKeys.transactions(L),
  transactionList: queryKeys.transactionList(L, { q: "a" }),
  transactionDetail: queryKeys.transactionDetail(L, "t1", 1),
  transferDetail: queryKeys.transferDetail(L, "x1", 1),
  budgets: queryKeys.budgets(L, "2026-11"),
  report: queryKeys.report(L, "spending", "2026-11"),
  contacts: queryKeys.contacts(L),
  clientBook: queryKeys.clientBook(L, "2026-11"),
  clientChoices: queryKeys.clientChoices(L),
  clientDetail: queryKeys.clientDetail(L, "c1", "2026-11"),
  receivables: queryKeys.receivables(L),
  clientServices: queryKeys.clientServices(L, "c1"),
  servicePayments: queryKeys.servicePayments(L, "s1"),
  receiptPreview: queryKeys.receiptPreview(L, "c1", "USD", 100),
  clientHistory: queryKeys.clientHistory(L, "c1"),
  loans: queryKeys.loans(L),
  loansOf: queryKeys.loansOf(L, "p1"),
  loanActivity: queryKeys.loanActivity(L, "p1", ["a1"]),
  loanRemoveCheck: queryKeys.loanRemoveCheck(L, "p1", "a1"),
  loanPeople: queryKeys.loanPeople(L),
  loanPerson: queryKeys.loanPerson(L, "p1"),
  currencies: queryKeys.currencies(L),
  rateLookup: queryKeys.rateLookup(L, "EUR", "2026-11-01"),
  imports: queryKeys.imports(L),
  importPreview: queryKeys.importPreview(L, "abc"),
  tags: queryKeys.tags(L),
  recurring: queryKeys.recurring(L),
  recurringRuns: queryKeys.recurringRuns(L, "r1"),
};

describe("queryKeys", () => {
  it("puts every ledger key under one prefix: the ledger's id", () => {
    for (const [name, key] of Object.entries(ledgerKeys)) {
      expect(key.slice(0, 2), name).toEqual(["ledger", L]);
    }
  });

  it("puts every area key under the prefix of its area", () => {
    for (const area of ledgerAreas) {
      expect(queryKeys[area](L).slice(0, 3), area).toEqual(["ledger", L, area]);
    }
  });

  it("keeps the account lists apart but all under accounts, the paged one included", () => {
    expect(queryKeys.activeAccounts(L)).not.toEqual(queryKeys.allAccounts(L));
    expect(queryKeys.accountPages(L)).not.toEqual(queryKeys.allAccounts(L));
    expect(queryKeys.accountPages(L).slice(0, 3)).toEqual(
      queryKeys.accounts(L),
    );
    expect(queryKeys.activeAccounts(L).slice(0, 3)).toEqual(
      queryKeys.accounts(L),
    );
    expect(queryKeys.allAccounts(L).slice(0, 3)).toEqual(queryKeys.accounts(L));
  });

  it("gives another month, another filter and another person their own entry", () => {
    expect(queryKeys.home(L, "2026-10")).not.toEqual(
      queryKeys.home(L, "2026-11"),
    );
    expect(queryKeys.transactionList(L, { q: "a" })).not.toEqual(
      queryKeys.transactionList(L, { q: "b" }),
    );
    expect(queryKeys.loansOf(L, "p1")).not.toEqual(queryKeys.loansOf(L, "p2"));
  });

  it("keeps the session, the ledgers and the change marker outside the ledger prefix", () => {
    expect(queryKeys.session[0]).toBe("session");
    expect(queryKeys.ledgers[0]).toBe("ledgers");
    expect(queryKeys.changes(L)[0]).toBe("changes");
  });
});
