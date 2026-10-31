import {
  type Account,
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
import { currentMonth, monthLabel, shiftMonth } from "../../lib/month";
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
function flow({
  income = 250000,
  spent = 15500,
  active = 12,
}: {
  income?: number;
  spent?: number;
  active?: number;
} = {}): CashFlowReport {
  const months = Array.from({ length: 12 }, (_, i) =>
    shiftMonth(month, i - 11),
  );
  return {
    from: months[0] as string,
    to: month,
    months: months.map((m, i) => {
      const current = i === 11;
      const on = i >= 12 - active;
      const inn = current ? income : 0;
      const out = current ? spent : on ? 700 : 0;
      return {
        month: m,
        income: usd(inn),
        spending: usd(out),
        net: usd(inn - out),
      };
    }),
  };
}
function worth(over: Partial<NetWorthReport> = {}): NetWorthReport {
  const months = Array.from({ length: 12 }, (_, i) =>
    shiftMonth(month, i - 11),
  );
  return {
    from: months[0] as string,
    to: month,
    historyStart: months[0] as string,
    months: months.map((m, i) => ({
      month: m,
      asOf: `${m}-28`,
      netWorth: usd(100000 + i * 10000),
      unconvertedCurrencies: i < 2 ? ["BDT"] : [],
    })),
    ...over,
  };
}
const account = (
  type: Account["type"],
  balance: number,
  currency = "USD",
): Account => ({
  id: newId(),
  ledgerId,
  name: `${type} account`,
  type,
  currency,
  openingBalance: { amount: balance, currency },
  inboundBonusBps: null,
  bonusCategoryId: null,
  feeCategoryId: null,
  defaultFee: null,
  contactId: null,
  balance: { amount: balance, currency },
  archivedAt: null,
  version: 1,
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
});
// $1,234.00 held and $345.00 owed: $889.00 net worth now.
const held = () => [account("bank", 123400), account("card", -34500)];
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
});
function mount(
  {
    report = spending(),
    cash = flow(),
    net = worth(),
    accounts = held(),
    privacy = false,
    only,
    hold,
  }: {
    report?: SpendingReport;
    cash?: CashFlowReport;
    net?: NetWorthReport;
    accounts?: Account[];
    privacy?: boolean;
    /** Only this report fails, so the others have answered. */
    only?: "spending" | "cash-flow" | "net-worth";
    /** The net worth report waits for this before it answers. */
    hold?: Promise<void>;
  } = {},
  fail = false,
) {
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    const target = String(url);
    if (only && target.includes(`/reports/${only}`))
      return new Response("{}", { status: 500 });
    if (hold && target.includes("/reports/net-worth")) await hold;
    if (target.includes("/accounts"))
      return fail
        ? new Response("{}", { status: 500 })
        : new Response(JSON.stringify({ items: accounts, nextCursor: null }));
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

const kept = (index: number) =>
  document.querySelectorAll<HTMLElement>(".ins-swatch > i")[index]?.style
    .background;

describe("InsightsPage", () => {
  it("is headed Insights with a month control and no eyebrow", async () => {
    mount();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Insights" }),
    ).toBeTruthy();
    expect(screen.queryByText("YOUR PERSONAL LEDGER")).toBeNull();
    expect(screen.getByRole("button", { name: "Previous month" })).toBeTruthy();
  });

  it("shows this month: spent, money in, net and how much was kept", async () => {
    mount();
    const card = (await screen.findByRole("region", {
      name: "This month",
    })) as HTMLElement;
    await waitFor(() => expect(card.textContent).toContain("Money in"));
    const text = card.textContent ?? "";
    expect(text).toContain("Spent$155.00");
    expect(text).toContain("Money in$2,500.00");
    expect(text).toContain("Net+$2,345.00");
    // 2,345 of 2,500 was kept.
    expect(text).toContain("94% kept");
    expect(
      within(card).getByRole("img", { name: "6% of the money in went out" }),
    ).toBeTruthy();
    expect(card.querySelector(".ins-pos")).not.toBeNull();
  });

  it("is all red and says nothing about kept money when more went out than came in", async () => {
    mount({ cash: flow({ income: 1000, spent: 15500 }) });
    const card = (await screen.findByRole("region", {
      name: "This month",
    })) as HTMLElement;
    const bar = await within(card).findByRole("img", {
      name: "More went out than came in",
    });
    expect(bar).toHaveClass("ins-segbar-over");
    expect(card.textContent).not.toContain("kept");
    expect(card.querySelector(".ins-pos")).toBeNull();
    expect(card.textContent).toContain("-$145.00");
  });

  it("draws no bar without money in", async () => {
    mount({ cash: flow({ income: 0, spent: 15500 }) });
    const card = (await screen.findByRole("region", {
      name: "This month",
    })) as HTMLElement;
    await waitFor(() => expect(card.textContent).toContain("Money in"));
    expect(within(card).queryByRole("img")).toBeNull();
    expect(card.textContent).not.toContain("kept");
  });

  it("lists categories with their share and a link to the entries", async () => {
    mount();
    const link = await screen.findByRole("link", { name: /Fun/ });
    expect(link.textContent).toContain("$55.00");
    expect(link.textContent).toContain("35.5%");
    expect(link.getAttribute("href")).toBe(
      `/transactions?categoryId=${fun}&from=${month}-01&to=${month}-28`,
    );
    expect(
      screen.getByRole("list", { name: "Spending by category" }),
    ).toBeTruthy();
  });

  it("keys each row to its slice of the bar by colour, the first five in the chart colours", async () => {
    mount();
    await screen.findByRole("link", { name: /Fun/ });
    expect(kept(0)).toBe("var(--chart-1)");
    expect(kept(1)).toBe("var(--chart-2)");
    const slices = [
      ...document.querySelectorAll<HTMLElement>(".ins-segbar-cats > i"),
    ];
    expect(slices.map((slice) => slice.style.background)).toEqual([
      "var(--chart-1)",
      "var(--chart-2)",
    ]);
    expect(Number.parseFloat(slices[0]?.style.width ?? "0")).toBeCloseTo(
      64.52,
      1,
    );
  });

  it("gives every category past the fifth the neutral colour", async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      ...category(newId(), `Category ${i}`, 700 - i, 1000),
      children: [],
    }));
    mount({ report: spending({ total: usd(4900), categories: many }) });
    await screen.findByRole("link", { name: /Category 6/ });
    expect([0, 4, 5, 6].map(kept)).toEqual([
      "var(--chart-1)",
      "var(--chart-5)",
      "var(--neutral-chart)",
      "var(--neutral-chart)",
    ]);
  });

  it("expands a parent to its subcategories and its own entries", async () => {
    mount();
    const user = userEvent.setup();
    const parent = await screen.findByRole("button", { name: /Food/ });
    expect(parent.getAttribute("aria-expanded")).toBe("false");
    expect(parent.textContent).toContain("1 subcategory");
    expect(parent.textContent).toContain("$100.00");
    expect(screen.queryByText("Groceries")).toBeNull();
    await user.click(parent);
    expect(parent.getAttribute("aria-expanded")).toBe("true");
    const sub = screen.getByRole("link", { name: /Groceries/ });
    expect(sub.getAttribute("href")).toContain(`categoryId=${groceries}`);
    expect(sub.textContent).toContain("$90.00");
    // 100.00 - 90.00 sits in Food itself.
    const direct = screen.getByRole("link", { name: /Directly in Food/ });
    expect(direct.textContent).toContain("$10.00");
    expect(direct.getAttribute("href")).toContain(`categoryId=${food}`);
    await user.click(parent);
    expect(screen.queryByText("Groceries")).toBeNull();
  });

  it("skips the row for a parent's own entries when there are none", async () => {
    mount({
      report: spending({
        categories: [
          {
            ...category(food, "Food", 9000, 10000),
            children: [category(groceries, "Groceries", 9000, 10000)],
          },
        ],
        total: usd(9000),
      }),
    });
    await userEvent.click(await screen.findByRole("button", { name: /Food/ }));
    expect(screen.getByRole("link", { name: /Groceries/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Directly in/ })).toBeNull();
  });

  it("says plural for several subcategories and marks an archived one", async () => {
    mount({
      report: spending({
        categories: [
          {
            ...category(food, "Food", 9000, 10000),
            children: [
              category(groceries, "Groceries", 5000, 5000),
              { ...category(newId(), "Old shop", 4000, 5000), archived: true },
            ],
          },
        ],
        total: usd(9000),
      }),
    });
    const parent = await screen.findByRole("button", { name: /Food/ });
    expect(parent.textContent).toContain("2 subcategories");
    await userEvent.click(parent);
    expect(
      screen.getByRole("link", { name: /Old shop \(archived\)/ }),
    ).toBeTruthy();
  });

  it("moves to another month and asks for it", async () => {
    const fetcher = mount();
    const user = userEvent.setup();
    await screen.findByRole("link", { name: /Fun/ });
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

  it("says when nothing was spent", async () => {
    mount({ report: spending({ total: usd(0), categories: [] }) });
    expect(await screen.findByText(/No spending in /)).toBeTruthy();
    expect(document.querySelector(".ins-segbar-cats")).toBeNull();
  });

  it("removes the digits in privacy mode, net worth now included", async () => {
    mount({ privacy: true });
    await screen.findByRole("link", { name: /Fun/ });
    await screen.findByRole("region", { name: "Net worth now" });
    expect(document.body.textContent).not.toMatch(/\$\d/);
    expect(document.body.textContent).not.toContain("2,500");
  });

  it("offers a retry when the reports cannot load", async () => {
    mount({}, true);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Couldn't load your insights.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("money in and out", () => {
  it("draws twelve months with a legend and the chosen month marked", async () => {
    mount();
    const card = (await screen.findByRole("region", {
      name: "Money in and out",
    })) as HTMLElement;
    expect(
      within(card).getByRole("img", { name: /Money in and spending/ }),
    ).toBeTruthy();
    expect(card.querySelectorAll(".ins-month")).toHaveLength(12);
    expect(card.querySelectorAll(".ins-selected")).toHaveLength(1);
    expect(card.querySelector(".ins-selected")?.textContent).toBe(
      new Intl.DateTimeFormat("en-US", { month: "short" }).format(
        new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 12),
      ),
    );
    expect(card.querySelector(".ins-legend")?.textContent).toBe("InOut");
  });

  it("is not drawn for one active month, and says nothing about it", async () => {
    mount({ cash: flow({ active: 1 }) });
    await screen.findByRole("link", { name: /Fun/ });
    expect(
      screen.queryByRole("region", { name: "Money in and out" }),
    ).toBeNull();
    expect(screen.queryByText("Nothing recorded in these months.")).toBeNull();
  });

  it("is not drawn without any active month", async () => {
    mount({ cash: flow({ income: 0, spent: 0, active: 0 }) });
    await screen.findByRole("link", { name: /Fun/ });
    expect(
      screen.queryByRole("region", { name: "Money in and out" }),
    ).toBeNull();
  });
});

describe("the figures", () => {
  it("are one disclosure at the foot with a table for each chart", async () => {
    mount();
    expect(await screen.findAllByText("Show the figures")).toHaveLength(1);
    const tables = await screen.findAllByRole("table", { hidden: true });
    expect(tables).toHaveLength(2);
    const [flowTable, worthTable] = tables as [HTMLElement, HTMLElement];
    expect(flowTable.textContent).toContain("$2,500.00");
    expect(
      within(flowTable).getAllByRole("row", { hidden: true }),
    ).toHaveLength(13);
    expect(worthTable.textContent).toContain("$2,100.00");
    expect(worthTable.textContent).toContain("without BDT");
    expect(worthTable.textContent).toContain(
      shiftMonth(month, -11).slice(0, 4),
    );
  });

  it("leave out the cash flow table when its chart is not drawn", async () => {
    mount({ cash: flow({ active: 1 }) });
    await screen.findByText("Show the figures");
    expect(await screen.findAllByRole("table", { hidden: true })).toHaveLength(
      1,
    );
  });
});

describe("net worth now", () => {
  it("shows what is held, what is owed and the total", async () => {
    mount();
    const card = (await screen.findByRole("region", {
      name: "Net worth now",
    })) as HTMLElement;
    const text = card.textContent ?? "";
    expect(text).toContain("$889.00");
    expect(text).toContain("Assets$1,234.00");
    expect(text).toContain("Liabilities-$345.00");
  });

  it("asks for every account, archived ones too", async () => {
    const fetcher = mount();
    await screen.findByRole("region", { name: "Net worth now" });
    expect(
      fetcher.mock.calls.some(([url]) =>
        /\/accounts\?.*status=all/.test(String(url)),
      ),
    ).toBe(true);
  });

  it("is left out in more than one currency", async () => {
    mount({ accounts: [account("bank", 100), account("bank", 100, "EUR")] });
    await screen.findByRole("link", { name: /Fun/ });
    expect(screen.queryByRole("region", { name: "Net worth now" })).toBeNull();
  });

  it("is left out with no accounts", async () => {
    mount({ accounts: [] });
    await screen.findByRole("link", { name: /Fun/ });
    expect(screen.queryByRole("region", { name: "Net worth now" })).toBeNull();
  });

  it("uses the full width for spending when neither chart nor net worth now is drawn", async () => {
    mount({ cash: flow({ active: 1 }), accounts: [] });
    await screen.findByRole("link", { name: /Fun/ });
    expect(document.querySelector(".ins-cols")).toHaveClass("ins-cols-one");
    expect(document.querySelector(".ins-stack")).toBeNull();
  });

  it("keeps the right column with either card", async () => {
    mount({ cash: flow({ active: 1 }) });
    await screen.findByRole("region", { name: "Net worth now" });
    expect(document.querySelector(".ins-cols")).not.toHaveClass("ins-cols-one");
  });
});

describe("net worth over time", () => {
  it("shows twelve bars, hatches the months missing a rate and says which", async () => {
    const fetcher = mount();
    expect(
      await screen.findByRole("img", { name: /Net worth at the end/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 2, name: "Net worth over time" }),
    ).toBeTruthy();
    expect(document.querySelectorAll(".ins-nw-bar")).toHaveLength(12);
    expect(document.querySelectorAll(".ins-nw-bar.ins-partial")).toHaveLength(
      2,
    );
    const note = document.querySelector(".ins-note")?.textContent ?? "";
    expect(note).toContain("incomplete");
    expect(note).toContain("BDT (2 of 12 months)");
    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).includes(`/reports/net-worth?to=${month}&months=12`),
      ),
    ).toBe(true);
  });

  it("draws negative net worth below a zero line in the neutral colour, and skips the note when complete", async () => {
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
    expect(document.querySelector(".ins-note")).toBeNull();
    expect(document.querySelectorAll(".ins-zero")).toHaveLength(12);
    expect(document.querySelectorAll(".ins-nw-bar.ins-neg")).toHaveLength(1);
  });

  it("draws no zero line when nothing is below it", async () => {
    mount();
    await screen.findByRole("img", { name: /Net worth at the end/ });
    expect(document.querySelector(".ins-zero")).toBeNull();
    expect(document.querySelector(".ins-neg")).toBeNull();
  });

  it("shows only the months since history started and says where it starts", async () => {
    const all = worth();
    mount({
      net: worth({
        historyStart: month,
        months: all.months.slice(-2).map((row) => ({
          ...row,
          unconvertedCurrencies: [],
        })),
      }),
    });
    expect(
      await screen.findByRole("img", {
        name: "Net worth at the end of each of the last 2 months",
      }),
    ).toBeTruthy();
    expect(screen.getByText(/History starts in /).textContent).toContain(
      monthLabel(month),
    );
    const months = document.querySelectorAll<HTMLElement>(
      '[aria-label^="Net worth at"] .ins-month',
    );
    expect(months).toHaveLength(2);
    // The two months sit at the right of the twelve-column grid, lined up with the chart above.
    expect(months[0]?.style.gridColumnStart).toBe("11");
  });

  it("says one month, not months", async () => {
    mount({
      net: worth({
        historyStart: month,
        months: worth()
          .months.slice(-1)
          .map((row) => ({
            ...row,
            unconvertedCurrencies: [],
          })),
      }),
    });
    expect(
      await screen.findByRole("img", {
        name: "Net worth at the end of each of the last 1 month",
      }),
    ).toBeTruthy();
  });

  it("shows only the history note when the window ends before history starts", async () => {
    mount({
      net: worth({ historyStart: shiftMonth(month, 3), months: [] }),
    });
    expect(await screen.findByText(/History starts in /)).toBeTruthy();
    expect(
      screen.queryByRole("img", { name: /Net worth at the end/ }),
    ).toBeNull();
    expect(
      screen.getByRole("heading", { level: 2, name: "Net worth over time" }),
    ).toBeTruthy();
  });

  it("has no history note for a full twelve months", async () => {
    mount();
    await screen.findByRole("img", { name: /Net worth at the end/ });
    expect(screen.queryByText(/History starts in /)).toBeNull();
  });
});

describe("from the month the ledger started to be used", () => {
  const since = shiftMonth(month, -2);
  const recent = () =>
    worth({
      historyStart: since,
      months: worth()
        .months.slice(-3)
        .map((row) => ({ ...row, unconvertedCurrencies: [] })),
    });
  const columns = (label: string) =>
    [
      ...document.querySelectorAll<HTMLElement>(
        `[aria-label^="${label}"] .ins-month`,
      ),
    ].map((li) => li.style.gridColumnStart);

  it("draws money in and out only for those months, at the right, lined up with net worth", async () => {
    mount({ net: recent() });
    expect(
      await screen.findByRole("img", {
        name: "Money in and spending for each of the last 3 months",
      }),
    ).toBeTruthy();
    expect(
      document.querySelectorAll('[aria-label^="Money in"] .ins-month'),
    ).toHaveLength(3);
    expect(columns("Money in")).toEqual(["10", "", ""]);
    expect(columns("Net worth at")).toEqual(["10", "", ""]);
  });

  it("lists only those months in the figures, the newest first", async () => {
    mount({ net: recent() });
    await screen.findByRole("img", { name: /Money in and spending/ });
    const tables = await screen.findAllByRole("table", { hidden: true });
    for (const table of tables)
      expect(within(table).getAllByRole("row", { hidden: true })).toHaveLength(
        4,
      );
    const [first] = within(tables[0] as HTMLElement).getAllByRole("rowheader", {
      hidden: true,
    });
    expect(first?.textContent).toContain(month.slice(0, 4));
    const names = within(tables[0] as HTMLElement)
      .getAllByRole("rowheader", { hidden: true })
      .map((cell) => cell.textContent);
    expect(names).toHaveLength(3);
    expect(names[0]).not.toBe(names[2]);
    expect(names[0]).toBe(
      `${new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 12))} ${month.slice(0, 4)}`,
    );
  });

  it("keeps the whole twelve months when the ledger started earlier", async () => {
    mount();
    await screen.findByRole("img", { name: /Money in and spending/ });
    expect(
      document.querySelectorAll('[aria-label^="Money in"] .ins-month'),
    ).toHaveLength(12);
    expect(columns("Money in")[0]).toBe("1");
  });

  it("draws no chart for a month before there was anything, and no table", async () => {
    mount({ net: worth({ historyStart: null, months: [] }) });
    await screen.findByRole("link", { name: /Fun/ });
    expect(
      screen.queryByRole("region", { name: "Money in and out" }),
    ).toBeNull();
    expect(screen.queryByText("Show the figures")).toBeNull();
  });

  it("does not draw the chart before it is known where history starts, then draws it once", async () => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    mount({ net: recent(), hold });
    await screen.findByRole("link", { name: /Fun/ });
    expect(
      screen.queryByRole("region", { name: "Money in and out" }),
    ).toBeNull();
    release();
    expect(
      await screen.findByRole("img", {
        name: "Money in and spending for each of the last 3 months",
      }),
    ).toBeTruthy();
  });

  it("draws the whole chart when net worth cannot say where history starts", async () => {
    mount({ only: "net-worth" });
    expect(
      await screen.findByRole("img", {
        name: "Money in and spending for each of the last 12 months",
      }),
    ).toBeTruthy();
  });

  it("still gives the summary the chosen month's money in", async () => {
    mount({ net: recent() });
    const summary = (await screen.findByRole("region", {
      name: "This month",
    })) as HTMLElement;
    await waitFor(() => expect(summary.textContent).toContain("$2,500.00"));
  });

  it("says one month, not months, when history started this month", async () => {
    mount({
      net: worth({
        historyStart: month,
        months: worth()
          .months.slice(-1)
          .map((row) => ({ ...row, unconvertedCurrencies: [] })),
      }),
      cash: flow({ active: 2 }),
    });
    // One month is one active month at most: the chart wants two, so it is not drawn.
    await screen.findByRole("link", { name: /Fun/ });
    expect(
      screen.queryByRole("region", { name: "Money in and out" }),
    ).toBeNull();
  });
});

describe("what the cards say when a part is missing", () => {
  it("shows Spent alone while money in cannot be had", async () => {
    mount({ only: "cash-flow" });
    const summary = (await screen.findByRole("region", {
      name: "This month",
    })) as HTMLElement;
    expect(summary.textContent).toContain("Spent$155.00");
    expect(summary.textContent).not.toContain("Money in");
    expect(summary.textContent).not.toContain("Net");
    expect(within(summary).queryByRole("img")).toBeNull();
  });

  it("says it could not refresh, not could not load, when one report failed and others answered", async () => {
    mount({ only: "spending" });
    expect(await screen.findByText(/Couldn't refresh/)).toBeTruthy();
    expect(screen.queryByText("Couldn't load your insights.")).toBeNull();
  });

  it("asks for the accounts again with Try again", async () => {
    const fetcher = mount({ only: "net-worth" });
    const user = userEvent.setup();
    await screen.findByRole("alert");
    const asked = () =>
      fetcher.mock.calls.filter(([url]) => String(url).includes("/accounts"))
        .length;
    await waitFor(() => expect(asked()).toBeGreaterThan(0));
    const before = asked();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(asked()).toBeGreaterThan(before));
  });

  it("does not call a net of nothing a plus, nor mark it", async () => {
    mount({ cash: flow({ income: 15500, spent: 15500 }) });
    const summary = (await screen.findByRole("region", {
      name: "This month",
    })) as HTMLElement;
    await waitFor(() => expect(summary.textContent).toContain("Money in"));
    expect(summary.textContent).toContain("Net$0.00");
    expect(summary.textContent).not.toContain("+$0.00");
    expect(summary.querySelector(".ins-pos")).toBeNull();
    expect(summary.textContent).toContain("0% kept");
  });

  it("sizes the bars against the peak of money in and spending together", async () => {
    mount();
    const card = (await screen.findByRole("region", {
      name: "Money in and out",
    })) as HTMLElement;
    const selected = card.querySelector<HTMLElement>(
      ".ins-selected",
    ) as HTMLElement;
    expect(selected.querySelector<HTMLElement>(".ins-in")?.style.height).toBe(
      "100%",
    );
    expect(
      Number.parseFloat(
        selected.querySelector<HTMLElement>(".ins-out")?.style.height ?? "0",
      ),
    ).toBeCloseTo(6.2, 1);
    // A month with only a little spending is still drawn, at the floor.
    const first = card.querySelector<HTMLElement>(
      ".ins-month .ins-out",
    ) as HTMLElement;
    expect(Number.parseFloat(first.style.height)).toBeCloseTo(2, 1);
  });

  it("keys the legend: In in the in colour, Out in the out colour", async () => {
    mount();
    const card = (await screen.findByRole("region", {
      name: "Money in and out",
    })) as HTMLElement;
    const keys = card.querySelectorAll(".ins-legend .ins-key");
    expect(keys[0]).toHaveClass("ins-in");
    expect(keys[1]).toHaveClass("ins-out");
  });

  it("shows a subcategory's share beside its amount", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: /Food/ }));
    expect(
      screen.getByRole("link", { name: /Groceries/ }).textContent,
    ).toContain("58.1%");
  });

  it("has no figures when there is neither a cash flow chart nor net worth months", async () => {
    mount({
      cash: flow({ active: 1 }),
      net: worth({ historyStart: null, months: [] }),
    });
    await screen.findByRole("link", { name: /Fun/ });
    expect(screen.queryByText("Show the figures")).toBeNull();
  });
});
