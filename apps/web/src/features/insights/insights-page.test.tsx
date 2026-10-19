import {
  type CashFlowReport,
  type NetWorthReport,
  newId,
  type SpendingReport,
} from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentMonth, shiftMonth } from "../../lib/month";
import { PrivacyContext } from "../../lib/preferences";
import { InsightsPage } from "./insights-page";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    className,
  }: {
    children: ReactNode;
    to: string;
    search?: Record<string, string>;
    className?: string;
  }) => (
    <a
      href={`${to}?${new URLSearchParams(search).toString()}`}
      className={className}
    >
      {children}
    </a>
  ),
}));

const ledgerId = newId();
const usd = (amount: number) => ({ amount, currency: "USD" as const });
const month = currentMonth();
const food = newId();
const groceries = newId();
const fun = newId();
const category = (id: string, name: string, cents: number, bps: number) => ({
  categoryId: id,
  name,
  color: null,
  archived: false,
  amount: usd(cents),
  shareBps: bps,
});
function spending(over: Partial<SpendingReport> = {}): SpendingReport {
  return {
    month,
    monthStart: `${month}-01`,
    monthEnd: `${month}-28`,
    total: usd(15500),
    categories: [
      {
        ...category(food, "Food", 10000, 6452),
        children: [category(groceries, "Groceries", 9000, 5806)],
      },
      { ...category(fun, "Fun", 5500, 3548), children: [] },
    ],
    ...over,
  };
}
function flow(): CashFlowReport {
  const months = Array.from({ length: 12 }, (_, i) =>
    shiftMonth(month, i - 11),
  );
  return {
    from: months[0] as string,
    to: month,
    months: months.map((m, i) => ({
      month: m,
      income: usd(i === 11 ? 250000 : 0),
      spending: usd(i === 11 ? 15500 : 700),
      net: usd(i === 11 ? 234500 : -700),
    })),
  };
}
function worth(over: Partial<NetWorthReport> = {}): NetWorthReport {
  const months = Array.from({ length: 12 }, (_, i) =>
    shiftMonth(month, i - 11),
  );
  return {
    from: months[0] as string,
    to: month,
    months: months.map((m, i) => ({
      month: m,
      asOf: `${m}-28`,
      netWorth: usd(100000 + i * 10000),
      unconvertedCurrencies: i < 2 ? ["BDT"] : [],
    })),
    ...over,
  };
}
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
});
function mount(
  { report = spending(), cash = flow(), net = worth(), privacy = false } = {},
  fail = false,
) {
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    const target = String(url);
    if (fail && target.includes("/reports/"))
      return new Response("{}", { status: 500 });
    if (target.includes("/reports/spending"))
      return new Response(JSON.stringify(report));
    if (target.includes("/reports/net-worth"))
      return new Response(JSON.stringify(net));
    if (target.includes("/reports/cash-flow"))
      return new Response(JSON.stringify(cash));
    return new Response(
      JSON.stringify({
        items: [
          {
            id: ledgerId,
            name: "Personal",
            baseCurrency: "USD",
            timeZone: null,
            version: 1,
            role: "viewer",
          },
        ],
      }),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PrivacyContext value={privacy}>
        <InsightsPage />
      </PrivacyContext>
    </QueryClientProvider>,
  );
  return fetcher;
}

describe("InsightsPage", () => {
  it("shows the month's total, categories with shares and a link to the entries", async () => {
    mount();
    expect(await screen.findByText(/Spent in /)).toBeTruthy();
    expect(document.querySelector(".stat-card .amount")?.textContent).toBe(
      "$155.00",
    );
    const funLink = screen.getByRole("link", { name: /Fun/ });
    expect(funLink.textContent).toContain("$55.00");
    expect(funLink.textContent).toContain("35.5% of spending");
    expect(funLink.getAttribute("href")).toBe(
      `/transactions?categoryId=${fun}&from=${month}-01&to=${month}-28`,
    );
    expect(document.querySelector(".stat-card")?.textContent).toContain(
      "Money in $2,500.00 · Net $2,345.00",
    );
  });

  it("expands a parent to its subcategories and its own entries", async () => {
    mount();
    const user = userEvent.setup();
    const parent = await screen.findByRole("button", { name: /Food/ });
    expect(parent.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Groceries")).toBeNull();
    await user.click(parent);
    expect(parent.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("link", { name: /Groceries/ }).getAttribute("href"),
    ).toContain(`categoryId=${groceries}`);
    // 100.00 - 90.00 sits in Food itself.
    const direct = screen.getByRole("link", { name: /Directly in Food/ });
    expect(direct.textContent).toContain("$10.00");
    expect(direct.getAttribute("href")).toContain(`categoryId=${food}`);
  });

  it("moves to another month and asks for it", async () => {
    const fetcher = mount();
    const user = userEvent.setup();
    await screen.findByText(/Spent in /);
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    const previous = shiftMonth(month, -1);
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(([url]) =>
          String(url).includes(`/reports/spending?month=${previous}`),
        ),
      ).toBe(true),
    );
    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).includes(`/reports/cash-flow?to=${previous}&months=12`),
      ),
    ).toBe(true);
  });

  it("shows empty states", async () => {
    mount({
      report: spending({ total: usd(0), categories: [] }),
      cash: {
        ...flow(),
        months: flow().months.map((row) => ({
          ...row,
          income: usd(0),
          spending: usd(0),
          net: usd(0),
        })),
      },
    });
    expect(await screen.findByText(/No spending in /)).toBeTruthy();
    expect(screen.getByText("Nothing recorded in these months.")).toBeTruthy();
  });

  it("lists the chart's figures in a table", async () => {
    mount();
    expect(await screen.findAllByText("Show the figures")).toHaveLength(2);
    const table = screen.getAllByRole("table")[0] as HTMLElement;
    expect(table.textContent).toContain("$2,500.00");
    expect(within(table).getAllByRole("row")).toHaveLength(13);
  });

  it("removes the digits in privacy mode", async () => {
    mount({ privacy: true });
    await screen.findByText(/Spent in /);
    expect(document.body.textContent).not.toContain("$155.00");
    expect(document.body.textContent).not.toContain("$55.00");
    expect(document.body.textContent).not.toContain("2,500");
  });

  it("offers a retry when the reports cannot load", async () => {
    mount({}, true);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Couldn't load your insights.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("shows net worth over time with the figures and an incomplete-month note", async () => {
    const fetcher = mount();
    expect(
      await screen.findByRole("img", { name: /Net worth at the end/ }),
    ).toBeTruthy();
    const first = shiftMonth(month, -11);
    const bars = document.querySelectorAll(".nw-bar");
    expect(bars).toHaveLength(12);
    expect(document.querySelectorAll(".nw-partial.nw-bar")).toHaveLength(2);
    const note = document.querySelector(".nw-note")?.textContent ?? "";
    expect(note).toContain("incomplete");
    expect(note).toContain("BDT (2 of 12 months)");
    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).includes(`/reports/net-worth?to=${month}&months=12`),
      ),
    ).toBe(true);
    const tables = screen.getAllByRole("table");
    const table = tables[tables.length - 1] as HTMLElement;
    expect(table.textContent).toContain("$2,100.00");
    expect(table.textContent).toContain("without BDT");
    expect(table.textContent).toContain(first.slice(0, 4));
  });

  it("draws negative net worth below a zero line and skips the note when complete", async () => {
    mount({
      net: worth({
        months: worth().months.map((row, i) => ({
          ...row,
          netWorth: usd(i === 11 ? -5000 : 20000),
          unconvertedCurrencies: [],
        })),
      }),
    });
    await screen.findByRole("img", { name: /Net worth at the end/ });
    expect(document.querySelector(".nw-note")).toBeNull();
    expect(document.querySelectorAll(".nw-zero").length).toBe(12);
  });

  it("removes the net worth digits in privacy mode", async () => {
    mount({ privacy: true });
    await screen.findByRole("img", { name: /Net worth at the end/ });
    expect(document.body.textContent).not.toContain("2,100");
    expect(document.body.textContent).not.toContain("1,000.00");
  });
});
