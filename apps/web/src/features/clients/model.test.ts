import type { Contact, Receivable } from "@ledgerline/shared";
import { describe, expect, it } from "vitest";
import {
  clientHint,
  clientMatches,
  defaultFilter,
  filterCounts,
  isOpenClient,
  overdueCount,
  paidInLabel,
  resolveFilter,
  serviceState,
  shortDate,
  sortClients,
  visibleClients,
} from "./model";

const usd = (amount: number) => ({ amount, currency: "USD" as const });
const client = (over: Partial<Contact> & { name: string }): Contact =>
  ({
    id: over.name.toLowerCase(),
    ledgerId: "l",
    phone: null,
    email: null,
    note: null,
    origin: "client",
    archivedAt: null,
    version: 1,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    openBalance: usd(0),
    openBalances: [],
    unconvertedCurrencies: [],
    oldestOpenServiceDate: null,
    paidThisMonth: { base: usd(0), amounts: [] },
    ...over,
  }) as Contact;
const owing = (name: string, cents: number, extra: Partial<Contact> = {}) =>
  client({
    name,
    openBalance: usd(cents),
    openBalances: [usd(cents)],
    oldestOpenServiceDate: "2026-10-16",
    ...extra,
  });
const service = (over: Partial<Receivable>): Receivable =>
  ({
    status: "unpaid",
    dueDate: null,
    outstanding: usd(100),
    ...over,
  }) as Receivable;

describe("which clients are open", () => {
  it("is a client with anything owed in any currency, even one without a rate", () => {
    expect(isOpenClient(owing("A", 100))).toBe(true);
    expect(isOpenClient(client({ name: "B" }))).toBe(false);
    expect(
      isOpenClient(
        client({
          name: "C",
          openBalance: usd(0),
          openBalances: [{ amount: 500, currency: "EUR" }],
          unconvertedCurrencies: ["EUR"],
        }),
      ),
    ).toBe(true);
  });
});

describe("sorting and filtering the list", () => {
  const list = [
    client({ name: "Zed" }),
    owing("Small", 100),
    owing("Big", 9000),
    owing("Arch", 500, { archivedAt: "2026-10-02T00:00:00.000Z" }),
    client({ name: "Amy" }),
  ];
  it("puts the most owed first, then by name", () => {
    expect(sortClients(list).map((c) => c.name)).toEqual([
      "Big",
      "Arch",
      "Small",
      "Amy",
      "Zed",
    ]);
  });
  it("filters by Open, Settled, All and Archived", () => {
    const names = (f: "open" | "settled" | "all" | "archived") =>
      visibleClients(list, f, "").map((c) => c.name);
    expect(names("open")).toEqual(["Big", "Arch", "Small"]);
    expect(names("settled")).toEqual(["Amy", "Zed"]);
    expect(names("all")).toEqual(["Big", "Arch", "Small", "Amy", "Zed"]);
    expect(names("archived")).toEqual(["Arch"]);
  });
  it("searches names without regard to case or surrounding spaces", () => {
    expect(clientMatches(client({ name: "Acme Studio" }), "  ACME ")).toBe(
      true,
    );
    expect(clientMatches(client({ name: "Acme Studio" }), "fjord")).toBe(false);
    expect(visibleClients(list, "all", "am").map((c) => c.name)).toEqual([
      "Amy",
    ]);
  });
  it("counts what each chip would show, ignoring the search", () => {
    expect(filterCounts(list)).toEqual({
      open: 3,
      settled: 2,
      all: 5,
      archived: 1,
    });
  });
  it("starts on Open when someone owes money, otherwise on All", () => {
    expect(defaultFilter(list)).toBe("open");
    expect(defaultFilter([client({ name: "Amy" })])).toBe("all");
    expect(defaultFilter([])).toBe("all");
  });
});

describe("the chip in use", () => {
  const archived = client({
    name: "Gone",
    archivedAt: "2026-10-02T00:00:00.000Z",
  });
  it("is the one chosen, else the default", () => {
    expect(resolveFilter("settled", [owing("A", 1)])).toBe("settled");
    expect(resolveFilter(null, [owing("A", 1)])).toBe("open");
    expect(resolveFilter(null, [client({ name: "B" })])).toBe("all");
  });
  it("falls back from Archived once nobody is archived", () => {
    expect(resolveFilter("archived", [archived])).toBe("archived");
    expect(resolveFilter("archived", [owing("A", 1)])).toBe("open");
  });
});

describe("a client's one hint", () => {
  it("says how long the oldest unpaid service has waited, or that it is archived", () => {
    expect(clientHint(owing("A", 100), "2026-10-28")).toBe(
      "Oldest unpaid 12d ago · Oct 16",
    );
    expect(clientHint(owing("A", 100), "2026-10-16")).toBe(
      "Oldest unpaid today · Oct 16",
    );
    expect(
      clientHint(
        owing("A", 100, { oldestOpenServiceDate: "2025-12-03" }),
        "2026-01-02",
      ),
    ).toBe("Oldest unpaid 30d ago · Dec 3, 2025");
    expect(clientHint(client({ name: "B" }), "2026-10-28")).toBeUndefined();
    expect(
      clientHint(
        client({ name: "B", archivedAt: "2026-10-02T00:00:00.000Z" }),
        "2026-10-28",
      ),
    ).toBe("Archived");
  });
  it("writes a short date, adding the year only when it is not this year", () => {
    expect(shortDate("2026-01-09", 2026)).toBe("Jan 9");
    expect(shortDate("2025-01-09", 2026)).toBe("Jan 9, 2025");
  });
});

describe("a service's state", () => {
  const today = "2026-10-31";
  it("is overdue only with money left, a due date and a day gone by", () => {
    expect(serviceState(service({ dueDate: "2026-10-30" }), today)).toBe(
      "overdue",
    );
    expect(serviceState(service({ dueDate: "2026-10-31" }), today)).toBe(
      "unpaid",
    );
    expect(
      serviceState(
        service({ dueDate: "2026-10-01", outstanding: usd(0), status: "paid" }),
        today,
      ),
    ).toBe("paid");
    expect(
      serviceState(
        service({
          dueDate: "2026-10-01",
          status: "writtenOff",
          outstanding: usd(0),
        }),
        today,
      ),
    ).toBe("written");
  });
  it("keeps partly paid, and a partly paid service past due is overdue", () => {
    expect(serviceState(service({ status: "partlyPaid" }), today)).toBe(
      "partly",
    );
    expect(
      serviceState(
        service({ status: "partlyPaid", dueDate: "2026-10-02" }),
        today,
      ),
    ).toBe("overdue");
  });
  it("counts the overdue ones", () => {
    expect(
      overdueCount(
        [
          service({ dueDate: "2026-10-01" }),
          service({ dueDate: "2026-11-01" }),
          service({
            dueDate: "2026-09-01",
            status: "paid",
            outstanding: usd(0),
          }),
        ],
        today,
      ),
    ).toBe(1);
  });
});

describe("Paid in label", () => {
  it("uses the short month name of the month asked for", () => {
    expect(paidInLabel("2026-10")).toBe("Paid in Oct");
    expect(paidInLabel("2026-03")).toBe("Paid in Mar");
  });
});
