import type { Account, CashFlowReport } from "@ledgerline/shared";
import { describe, expect, it } from "vitest";
import {
  activeMonths,
  barHeight,
  categoryColour,
  fromHistory,
  keptPercent,
  percentOf,
  showCashFlow,
  summaryBar,
  worthBar,
  worthSnapshot,
  zeroAt,
} from "./model";

const usd = (amount: number) => ({ amount, currency: "USD" as const });

describe("percentOf", () => {
  it("is one decimal, and 0.0% of nothing", () => {
    expect(percentOf(5500, 15500)).toBe("35.5%");
    expect(percentOf(1, 3)).toBe("33.3%");
    expect(percentOf(100, 100)).toBe("100.0%");
    expect(percentOf(100, 0)).toBe("0.0%");
  });
});

describe("keptPercent", () => {
  it("is the share of the money in that was kept, rounded", () => {
    expect(keptPercent(543840, 132640)).toBe(76);
    expect(keptPercent(1000, 1000)).toBe(0);
    expect(keptPercent(3, 2)).toBe(33);
  });
  it("says nothing without money in or when more went out than came in", () => {
    expect(keptPercent(0, 500)).toBeNull();
    // Nothing in and nothing out is not "NaN% kept".
    expect(keptPercent(0, 0)).toBeNull();
    expect(keptPercent(1000, 1001)).toBeNull();
  });
});

describe("summaryBar", () => {
  it("is nothing without money in", () => {
    expect(summaryBar(0, 0)).toEqual({ kind: "none" });
    expect(summaryBar(0, 500)).toEqual({ kind: "none" });
  });
  it("splits spent against kept", () => {
    expect(summaryBar(1000, 250)).toEqual({ kind: "split", spent: 0.25 });
    expect(summaryBar(1000, 1000)).toEqual({ kind: "split", spent: 1 });
    expect(summaryBar(1000, 0)).toEqual({ kind: "split", spent: 0 });
  });
  it("is all red when more went out than came in", () => {
    expect(summaryBar(1000, 1001)).toEqual({ kind: "over" });
  });
});

describe("categoryColour", () => {
  it("gives the first five categories the five chart colours and the rest the neutral one", () => {
    expect([0, 1, 2, 3, 4].map(categoryColour)).toEqual([
      "var(--chart-1)",
      "var(--chart-2)",
      "var(--chart-3)",
      "var(--chart-4)",
      "var(--chart-5)",
    ]);
    expect(categoryColour(5)).toBe("var(--neutral-chart)");
    expect(categoryColour(40)).toBe("var(--neutral-chart)");
  });
});

describe("the cash flow chart", () => {
  const month = (income: number, spending: number, n: number) => ({
    month: `2026-${String(n).padStart(2, "0")}`,
    income: usd(income),
    spending: usd(spending),
    net: usd(income - spending),
  });
  const report = (rows: ReturnType<typeof month>[]): CashFlowReport => ({
    from: "2026-01",
    to: "2026-12",
    months: rows,
  });
  it("counts the months with money in or spending", () => {
    expect(
      activeMonths(report([month(0, 0, 1), month(5, 0, 2), month(0, 7, 3)])),
    ).toBe(2);
    expect(activeMonths(report([month(0, 0, 1)]))).toBe(0);
  });
  it("shows from two active months, not from one", () => {
    expect(showCashFlow(report([month(0, 0, 1), month(5, 0, 2)]))).toBe(false);
    expect(showCashFlow(report([month(5, 0, 1), month(0, 7, 2)]))).toBe(true);
    expect(showCashFlow(report([month(5, 7, 1)]))).toBe(false);
  });
  it("scales a bar to the peak, at least 2 per cent, none for nothing", () => {
    expect(barHeight(500, 1000)).toBe(50);
    expect(barHeight(1000, 1000)).toBe(100);
    expect(barHeight(1, 1000)).toBe(2);
    expect(barHeight(0, 1000)).toBe(0);
    expect(barHeight(5, 0)).toBe(0);
  });
});

describe("worthBar", () => {
  it("puts a positive bar above the zero line and a negative one below it", () => {
    // Range 0 to 1000: zero is at the bottom.
    expect(worthBar(500, 1000, 0)).toEqual({ bottom: 0, height: 50 });
    // Range -500 to 500: zero is half way up.
    expect(worthBar(250, 500, -500)).toEqual({ bottom: 50, height: 25 });
    expect(worthBar(-250, 500, -500)).toEqual({ bottom: 25, height: 25 });
  });
  it("draws nothing for zero or a flat range, and at least 1 per cent for a figure", () => {
    expect(worthBar(0, 500, -500)).toEqual({ bottom: 50, height: 0 });
    expect(worthBar(0, 0, 0)).toEqual({ bottom: 0, height: 0 });
    expect(worthBar(1, 100000, 0).height).toBe(1);
  });
});

describe("zeroAt", () => {
  it("is where the zero line sits, in per cent of the chart", () => {
    expect(zeroAt(500, -500)).toBe(50);
    expect(zeroAt(1000, -250)).toBe(20);
    expect(zeroAt(1000, 0)).toBe(0);
    expect(zeroAt(0, 0)).toBe(0);
  });
});

describe("fromHistory", () => {
  const rows = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map(
    (month, index) => ({
      month,
      income: usd(index),
      spending: usd(index),
      net: usd(0),
    }),
  );
  const report: CashFlowReport = {
    from: "2026-06",
    to: "2026-10",
    months: rows,
  };
  it("leaves out the months before the ledger started to be used", () => {
    expect(
      fromHistory(report, "2026-08").months.map((row) => row.month),
    ).toEqual(["2026-08", "2026-09", "2026-10"]);
  });
  it("keeps the month it starts in, and every month when it started earlier", () => {
    expect(fromHistory(report, "2026-10").months).toHaveLength(1);
    expect(fromHistory(report, "2026-06").months).toHaveLength(5);
    expect(fromHistory(report, "2020-01").months).toHaveLength(5);
  });
  it("has no months when the history starts after the window", () => {
    expect(fromHistory(report, "2026-11").months).toEqual([]);
  });
  it("has no months when there is no history at all", () => {
    expect(fromHistory(report, null).months).toEqual([]);
  });
  it("is left whole until the net worth report has said where history starts", () => {
    expect(fromHistory(report, undefined)).toBe(report);
  });
  it("keeps the report's own range and the rows as they were", () => {
    const trimmed = fromHistory(report, "2026-09");
    expect(trimmed.from).toBe("2026-06");
    expect(trimmed.to).toBe("2026-10");
    expect(trimmed.months[0]).toBe(rows[3]);
  });
});

describe("worthSnapshot", () => {
  const account = (type: Account["type"], balance: number, currency = "USD") =>
    ({ type, balance: { amount: balance, currency } }) as unknown as Account;
  it("adds the held and the owed, as balances", () => {
    expect(
      worthSnapshot([
        account("bank", 156176500),
        account("cash", 1000),
        account("card", -61230),
        account("loan", -600000),
      ]),
    ).toEqual({
      assets: usd(156177500),
      liabilities: usd(-661230),
      net: usd(155516270),
    });
  });
  it("counts an overdrawn bank account with the assets", () => {
    expect(
      worthSnapshot([account("bank", -200), account("bank", 1000)])?.assets,
    ).toEqual(usd(800));
  });
  it("is null with no accounts", () => {
    expect(worthSnapshot([])).toBeNull();
  });
  it("is null with more than one currency, which needs rates only the server has", () => {
    expect(
      worthSnapshot([account("bank", 100), account("bank", 100, "EUR")]),
    ).toBeNull();
  });
  it("keeps the account's own currency", () => {
    expect(worthSnapshot([account("bank", 100, "EUR")])?.net).toEqual({
      amount: 100,
      currency: "EUR",
    });
  });
});
