import { type HomeSummary, newId } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentMonth, monthLabel } from "../../lib/month";
import { PrivacyContext } from "../../lib/preferences";
import { HomePage } from "./home-page";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    className,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    search?: Record<string, string>;
    className?: string;
  }) => (
    <a
      href={search ? `${to}?${new URLSearchParams(search)}` : to}
      className={className}
      {...rest}
    >
      {children}
    </a>
  ),
}));
const workspace = vi.hoisted(() => ({
  current: null as null | {
    blocked: boolean;
    openTransaction: (t: unknown) => void;
  },
}));
vi.mock("../transactions/workspace", () => ({
  useTransactionWorkspace: () => workspace.current,
}));
// What an amount in another currency is worth: EUR at 1.1217, nothing for anything else.
vi.mock("../currencies/base-value", () => ({
  useBaseValues: () => ({
    baseCurrency: "USD",
    currencies: ["USD", "EUR"],
    baseValue: (money: { amount: number; currency: string }) =>
      money.currency === "EUR" ? Math.round(money.amount * 1.1217) : null,
  }),
}));
const ledgerId = newId();
const usd = (amount: number) => ({ amount, currency: "USD" as const });
const checking = newId();
function entry(over: Record<string, unknown> = {}) {
  return {
    id: newId(),
    ledgerId,
    accountId: checking,
    categoryId: newId(),
    kind: "expense",
    date: "2026-10-05",
    time: null,
    amount: usd(-4500),
    status: "cleared",
    payee: null,
    note: null,
    fxRate: "1",
    baseAmount: usd(-4500),
    transferId: null,
    relatedTransferId: null,
    feeTransferId: null,
    tipPaymentId: null,
    receivablePaymentId: null,
    receivableId: null,
    isSplit: false,
    splits: [],
    tags: [],
    version: 1,
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
    ...over,
  };
}
function summary(over: Partial<HomeSummary> = {}): HomeSummary {
  return {
    month: currentMonth(),
    monthStart: "2026-10-01",
    monthEnd: "2026-10-31",
    inHand: usd(359000),
    netWorth: usd(388725),
    liabilitiesOwed: usd(39000),
    accounts: [
      { id: checking, name: "Checking", type: "bank", balance: usd(354000) },
      { id: newId(), name: "Overdrawn", type: "bank", balance: usd(-2500) },
    ],
    otherActive: { count: 2, balance: usd(5000) },
    archived: { count: 1, balance: usd(50000) },
    moneyIn: usd(265000),
    moneyOut: usd(14775),
    owed: { total: usd(28000), personCount: 2 },
    loans: { lent: usd(60000), borrowed: usd(12500) },
    pendingCount: 1,
    latest: [
      {
        transaction: entry({ payee: "Corner Cafe" }),
        accountName: "Checking",
        categoryLabel: "Food",
        counterpartAccountName: null,
      },
      {
        transaction: entry({
          kind: "transfer",
          transferId: newId(),
          relatedTransferId: null,
          feeTransferId: null,
          tipPaymentId: null,
          categoryId: null,
          amount: usd(-5000),
          baseAmount: usd(-5000),
        }),
        accountName: "Checking",
        categoryLabel: null,
        counterpartAccountName: "Cash",
      },
      {
        transaction: entry({ status: "pending", amount: usd(-2000) }),
        accountName: "Checking",
        categoryLabel: "Food",
        counterpartAccountName: null,
      },
    ],
    setup: { hasActiveAccount: true, hasCategory: true },
    ...over,
  } as HomeSummary;
}

type Row = {
  name: string;
  type?: string;
  currency?: string;
  balance?: number;
  contactId?: string | null;
};
function accountRow(row: Row) {
  const currency = row.currency ?? "USD";
  return {
    id: newId(),
    ledgerId,
    name: row.name,
    type: row.type ?? "bank",
    currency,
    openingBalance: { amount: 0, currency },
    inboundBonusBps: null,
    bonusCategoryId: null,
    feeCategoryId: null,
    defaultFee: null,
    contactId: row.contactId ?? null,
    balance: { amount: row.balance ?? 100000, currency },
    archivedAt: null,
    version: 1,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}
const defaultAccounts: Row[] = [
  { name: "Checking", type: "bank", balance: 354000 },
  { name: "Overdrawn", type: "bank", balance: -2500 },
  { name: "Visa", type: "card", balance: -39000 },
];

let client: QueryClient;
beforeEach(() => {
  workspace.current = null;
});
afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
});
function mount(
  responses: (() => Response | Promise<Response>)[],
  { role = "owner", privacy = false, accounts = defaultAccounts } = {},
) {
  let home = 0;
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    const address = String(url);
    if (address.includes("/home")) {
      const respond = responses[Math.min(home, responses.length - 1)];
      home++;
      return (respond as () => Response)();
    }
    if (address.includes("/accounts"))
      return new Response(
        JSON.stringify({ items: accounts.map(accountRow), nextCursor: null }),
      );
    return new Response(
      JSON.stringify({
        items: [
          {
            id: ledgerId,
            name: "Personal",
            baseCurrency: "USD",
            timeZone: null,
            version: 1,
            role,
          },
        ],
      }),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <PrivacyContext value={privacy}>
        <HomePage />
      </PrivacyContext>
    </QueryClientProvider>,
  );
  return { fetcher, view };
}
const ok = (body: unknown) => () => new Response(JSON.stringify(body));
const fail = () =>
  new Response(
    JSON.stringify({
      title: "x",
      type: "x",
      status: 500,
      detail: "Server broke",
    }),
    { status: 500 },
  );

describe("Home", () => {
  it("requests the device's current month and shows exact totals", async () => {
    const { fetcher } = mount([ok(summary())]);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(await screen.findByText("$3,590.00")).toBeInTheDocument();
    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).endsWith(`/home?month=${currentMonth()}`),
      ),
    ).toBe(true);
    expect(
      screen.getByRole("heading", { level: 1, name: "Home" }),
    ).toBeInTheDocument();
    expect(screen.getByText("In hand")).toBeInTheDocument();
    expect(screen.getByText("$2,650.00")).toBeInTheDocument();
    expect(screen.getByText("$147.75")).toBeInTheDocument();
    expect(screen.queryByText("Net worth")).not.toBeInTheDocument();
    expect(screen.queryByText("$3,887.25")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute(
      "href",
      "/transactions",
    );
  });

  it("has no eyebrow, no subtitle and no long explanation", async () => {
    mount([ok(summary())]);
    await screen.findByText("In hand");
    expect(screen.queryByText("YOUR PERSONAL LEDGER")).toBeNull();
    expect(screen.queryByText(/Positive balances in bank/)).toBeNull();
    expect(screen.queryByText(/Cleared (income|spending) in/)).toBeNull();
  });

  describe("the hero's small figures", () => {
    it("names who owes, each with its link", async () => {
      mount([ok(summary())]);
      await screen.findByText("In hand");
      expect(screen.getByRole("link", { name: /Clients owe/ })).toHaveAttribute(
        "href",
        "/clients",
      );
      expect(screen.getByRole("link", { name: /People owe/ })).toHaveAttribute(
        "href",
        "/loans",
      );
      expect(screen.getByRole("link", { name: /You owe/ })).toHaveAttribute(
        "href",
        "/loans",
      );
      expect(
        within(screen.getByRole("link", { name: /Clients owe/ })).getByText(
          "$280.00",
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole("link", { name: /People owe/ })).getByText(
          "$600.00",
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole("link", { name: /You owe/ })).getByText(
          "$125.00",
        ),
      ).toBeInTheDocument();
      // Each figure carries its page's icon.
      for (const name of [/Clients owe/, /People owe/, /You owe/])
        expect(
          screen.getByRole("link", { name }).querySelector("svg"),
        ).not.toBeNull();
      expect(screen.queryByText(/Lent out|Owed to you/)).toBeNull();
    });

    it("leaves out each figure that is zero, on its own", async () => {
      mount([
        ok(
          summary({
            owed: {
              total: usd(0),
              personCount: 0,
              otherCurrencies: [],
              unconvertedCurrencies: [],
            },
            loans: { lent: usd(0), borrowed: usd(12500) },
          }),
        ),
      ]);
      await screen.findByText("In hand");
      expect(screen.queryByText("Clients owe")).toBeNull();
      expect(screen.queryByText("People owe")).toBeNull();
      expect(screen.getByText("You owe")).toBeInTheDocument();
    });

    it("shows no small figures at all when nobody owes anything", async () => {
      const { view } = mount([
        ok(
          summary({
            owed: {
              total: usd(0),
              personCount: 0,
              otherCurrencies: [],
              unconvertedCurrencies: [],
            },
            loans: { lent: usd(0), borrowed: usd(0) },
          }),
        ),
      ]);
      await screen.findByText("In hand");
      expect(view.container.querySelector(".ui-hero-figs")).toBeNull();
    });
  });

  describe("This month", () => {
    it("is one link to Insights with money in, money out and the net with a plus sign", async () => {
      mount([ok(summary())]);
      await screen.findByText("In hand");
      const card = screen.getByRole("link", { name: /This month/ });
      expect(card).toHaveAttribute("href", "/insights");
      expect(
        within(card).getByText(monthLabel(currentMonth())),
      ).toBeInTheDocument();
      expect(within(card).getByText("Money in")).toBeInTheDocument();
      expect(within(card).getByText("Money out")).toBeInTheDocument();
      expect(within(card).getByText("+$2,502.25")).toBeInTheDocument();
    });

    it("says how much of the money in went out, and turns over at more than all of it", async () => {
      mount([ok(summary({ moneyIn: usd(100000), moneyOut: usd(150000) }))]);
      await screen.findByText("In hand");
      const bar = screen.getByRole("img", {
        name: "100% of money in went out",
      });
      expect(bar).toHaveClass("ui-bar-over");
      expect(screen.getByText("-$500.00")).toBeInTheDocument();
    });

    it("shows an empty bar and a zero net for an empty month", async () => {
      mount([ok(summary({ moneyIn: usd(0), moneyOut: usd(0) }))]);
      await screen.findByText("In hand");
      expect(
        screen.getByRole("img", { name: "0% of money in went out" }),
      ).not.toHaveClass("ui-bar-over");
    });
  });

  describe("the notes above the page", () => {
    it("makes the pending note a link to the pending entries", async () => {
      mount([ok(summary())]);
      expect(
        await screen.findByRole("link", { name: /^1 pending entry/ }),
      ).toHaveAttribute("href", "/transactions?status=pending");
    });

    it("counts several pending entries", async () => {
      mount([ok(summary({ pendingCount: 3 }))]);
      expect(
        await screen.findByRole("link", { name: /^3 pending entries/ }),
      ).toHaveTextContent("Not counted yet");
    });

    it("has no pending note when nothing is pending", async () => {
      mount([ok(summary({ pendingCount: 0 }))]);
      await screen.findByText("In hand");
      expect(screen.queryByText(/pending entr(y|ies)/)).toBeNull();
    });

    it("shows only the notes that apply", async () => {
      mount([ok(summary({ pendingCount: 1, unconvertedCurrencies: [] }))]);
      await screen.findByRole("link", { name: /^1 pending entry/ });
      expect(screen.queryByText(/No exchange rate/)).toBeNull();
      expect(screen.queryByText("Set up categories")).toBeNull();
      cleanup();
      mount([ok(summary({ pendingCount: 0, unconvertedCurrencies: ["JPY"] }))]);
      await screen.findByRole("link", { name: /^No exchange rate for JPY/ });
      expect(screen.queryByText(/pending entr/)).toBeNull();
    });

    it("shows the categories note on its own, and no card at all when there is nothing to note", async () => {
      mount([
        ok(
          summary({
            pendingCount: 0,
            setup: { hasActiveAccount: true, hasCategory: false },
          }),
        ),
      ]);
      expect(
        await screen.findByRole("link", { name: /^Set up categories/ }),
      ).toBeInTheDocument();
      cleanup();
      const { view } = mount([ok(summary({ pendingCount: 0 }))]);
      await screen.findByText("In hand");
      expect(view.container.querySelector(".ui-list:empty")).toBeNull();
      expect(view.container.querySelectorAll(".ui-list")).toHaveLength(2);
    });

    it("links a currency with no rate to where a rate is added", async () => {
      mount([ok(summary({ unconvertedCurrencies: ["JPY"] }))]);
      const row = await screen.findByRole("link", {
        name: /^No exchange rate for JPY/,
      });
      expect(row).toHaveAttribute("href", "/currencies");
      expect(row).toHaveTextContent("Add a rate");
    });

    it("uses the plural for several currencies", async () => {
      mount([ok(summary({ unconvertedCurrencies: ["JPY", "CHF"] }))]);
      expect(
        await screen.findByRole("link", {
          name: /^No exchange rate for JPY, CHF/,
        }),
      ).toBeInTheDocument();
    });
  });

  describe("accounts", () => {
    it("lists Cash and banking, then Cards and loans, with their counts", async () => {
      mount([ok(summary())]);
      await screen.findByText("Checking");
      expect(screen.getByText("Cash and banking")).toBeInTheDocument();
      expect(screen.getByText("Cards and loans")).toBeInTheDocument();
      expect(screen.getByText("Visa")).toBeInTheDocument();
      expect(screen.getByText("Card")).toBeInTheDocument();
      expect(screen.getByText("$3,540.00")).toBeInTheDocument();
      expect(screen.queryByText(/other accounts?/)).toBeNull();
    });

    it("says Overdrawn for money to hand below zero, never for a card", async () => {
      mount([ok(summary())]);
      await screen.findByText("Checking");
      expect(screen.getByText("-$25.00")).toBeInTheDocument();
      expect(screen.getAllByText(/Overdrawn/)).toHaveLength(2); // the account's name and its hint
      expect(screen.getByText("Bank · Overdrawn")).toBeInTheDocument();
      expect(screen.getByText("-$390.00")).toBeInTheDocument();
      // Only money to hand is marked; what is owed on a card is not "overdrawn".
      expect(screen.getByText("-$25.00").parentElement).toHaveClass("home-neg");
      expect(screen.getByText("-$390.00").parentElement).not.toHaveClass(
        "home-neg",
      );
      expect(screen.getByText("Card")).toBeInTheDocument();
    });

    it("does not list a client's balance account", async () => {
      mount([ok(summary())], {
        accounts: [
          { name: "Checking", balance: 1000 },
          { name: "Acme Studio balance", contactId: newId(), balance: 777700 },
        ],
      });
      await screen.findByText("Checking");
      expect(screen.queryByText("Acme Studio balance")).toBeNull();
    });

    it("links each account to Accounts", async () => {
      mount([ok(summary())]);
      const title = await screen.findByText("Checking", {
        selector: ".ui-row-title",
      });
      expect(title.closest("a")).toHaveAttribute("href", "/accounts");
    });

    it("shows the archived accounts as one row without an amount", async () => {
      mount([ok(summary())]);
      const row = await screen.findByRole("link", {
        name: /Archived accounts/,
      });
      expect(row).toHaveAttribute("href", "/accounts");
      expect(row).toHaveTextContent("1 not counted in In hand");
      expect(row).not.toHaveTextContent("$");
    });

    it("has no archived row when none are archived", async () => {
      mount([ok(summary({ archived: { count: 0, balance: usd(0) } }))]);
      await screen.findByText("Checking");
      expect(screen.queryByText("Archived accounts")).toBeNull();
    });

    it("shows foreign accounts in their own currency with the base value beside them", async () => {
      mount([ok(summary())], {
        accounts: [
          { name: "Euro bank", currency: "EUR", balance: 100000 },
          {
            name: "Yen wallet",
            type: "wallet",
            currency: "JPY",
            balance: 5000,
          },
        ],
      });
      await screen.findByText("Euro bank");
      expect(screen.getByText("€1,000.00")).toBeInTheDocument();
      expect(
        screen.getByText(
          (_, element) =>
            !!element?.classList.contains("base-note") &&
            element.textContent === "About $1,121.70",
        ),
      ).toBeInTheDocument();
    });

    it("says it could not load the accounts, and tries again", async () => {
      let calls = 0;
      let first = true;
      const fetcher = vi.fn<typeof fetch>(async (url) => {
        const address = String(url);
        if (address.includes("/home"))
          return new Response(JSON.stringify(summary()));
        if (address.includes("/accounts")) {
          calls++;
          if (first) return fail();
          return new Response(
            JSON.stringify({
              items: [accountRow({ name: "Checking" })],
              nextCursor: null,
            }),
          );
        }
        return new Response(
          JSON.stringify({
            items: [
              {
                id: ledgerId,
                name: "P",
                baseCurrency: "USD",
                timeZone: null,
                version: 1,
                role: "owner",
              },
            ],
          }),
        );
      });
      vi.stubGlobal("fetch", fetcher);
      client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={client}>
          <PrivacyContext value={false}>
            <HomePage />
          </PrivacyContext>
        </QueryClientProvider>,
      );
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Couldn't load your accounts.");
      first = false;
      await userEvent.click(
        within(alert.parentElement as HTMLElement).getByRole("button", {
          name: "Try again",
        }),
      );
      expect(await screen.findByText("Checking")).toBeInTheDocument();
      expect(calls).toBe(2);
    });
  });

  describe("the currency control", () => {
    const two: Row[] = [
      { name: "Checking", currency: "USD", balance: 1000 },
      { name: "Savings", type: "savings", currency: "USD", balance: 2000 },
      { name: "Euro bank", currency: "EUR", balance: 3000 },
    ];
    it("is not there with one currency", async () => {
      mount([ok(summary())]);
      await screen.findByText("Checking");
      expect(screen.queryByRole("radiogroup", { name: "Currency" })).toBeNull();
    });

    it("is there with two, starting at the currency with most accounts and showing only it", async () => {
      mount([ok(summary())], { accounts: two });
      await screen.findByText("Checking");
      const control = screen.getByRole("radiogroup", { name: "Currency" });
      expect(within(control).getByRole("radio", { name: "USD" })).toBeChecked();
      expect(screen.queryByText("Euro bank")).toBeNull();
    });

    it("switches the list when another currency is chosen", async () => {
      mount([ok(summary())], { accounts: two });
      await screen.findByText("Checking");
      await userEvent.click(screen.getByRole("radio", { name: "EUR" }));
      expect(screen.getByText("Euro bank")).toBeInTheDocument();
      expect(screen.queryByText("Checking")).toBeNull();
    });

    it("is a select when there are more than four currencies", async () => {
      mount([ok(summary())], {
        accounts: ["USD", "EUR", "GBP", "JPY", "CHF"].map((currency) => ({
          name: `${currency} account`,
          currency,
        })),
      });
      await screen.findByText("CHF account");
      expect(screen.queryByRole("radiogroup", { name: "Currency" })).toBeNull();
      expect(
        screen.getByRole("combobox", { name: "Currency" }),
      ).toBeInTheDocument();
    });
  });

  describe("Latest transactions", () => {
    it("shows one row per entry, with a transfer as one row from one account to the other", async () => {
      mount([ok(summary())]);
      await screen.findByText("Corner Cafe");
      expect(
        screen.getByRole("heading", { level: 2, name: "Latest transactions" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Checking → Cash")).toBeInTheDocument();
      expect(screen.getByText(/^Transfer · /)).toBeInTheDocument();
      expect(screen.getByText("Pending")).toBeInTheDocument();
    });

    it("opens the entry in place and is disabled while the workspace is blocked", async () => {
      const openTransaction = vi.fn();
      workspace.current = { blocked: false, openTransaction };
      mount([ok(summary())]);
      await userEvent.click(
        await screen.findByRole("button", { name: /Corner Cafe/ }),
      );
      expect(openTransaction).toHaveBeenCalledTimes(1);
      cleanup();
      workspace.current = { blocked: true, openTransaction };
      mount([ok(summary())]);
      expect(
        await screen.findByRole("button", { name: /Corner Cafe/ }),
      ).toBeDisabled();
    });

    it("links to Transactions when there is no workspace", async () => {
      mount([ok(summary())]);
      expect(
        await screen.findByRole("link", { name: /Corner Cafe/ }),
      ).toHaveAttribute("href", "/transactions");
    });

    it("shows income with a plus sign and a transfer without one", async () => {
      mount([
        ok(
          summary({
            latest: [
              {
                transaction: entry({
                  payee: "Acme",
                  amount: usd(125000),
                  kind: "income",
                }),
                accountName: "Checking",
                categoryLabel: "Pay",
                counterpartAccountName: null,
              },
              {
                transaction: entry({
                  kind: "transfer",
                  transferId: newId(),
                  amount: usd(-5000),
                }),
                accountName: "Checking",
                categoryLabel: null,
                counterpartAccountName: "Cash",
              },
            ] as HomeSummary["latest"],
          }),
        ),
      ]);
      expect(await screen.findByText("+$1,250.00")).toBeInTheDocument();
      expect(screen.getByText("$50.00")).toBeInTheDocument();
    });

    it("shows the incoming leg of a transfer without a plus sign or the income colour", async () => {
      mount([
        ok(
          summary({
            latest: [
              {
                transaction: entry({
                  kind: "transfer",
                  transferId: newId(),
                  amount: usd(5000),
                }),
                accountName: "Checking",
                categoryLabel: null,
                counterpartAccountName: "Cash",
              },
            ] as HomeSummary["latest"],
          }),
        ),
      ]);
      const amount = await screen.findByText("$50.00");
      expect(screen.queryByText("+$50.00")).toBeNull();
      expect(amount.parentElement).not.toHaveClass("home-pos");
    });

    it("shows a foreign entry in its own currency with the base value", async () => {
      mount([
        ok(
          summary({
            latest: [
              {
                transaction: entry({
                  payee: "Cafe Paris",
                  amount: { amount: -1250, currency: "EUR" },
                  baseAmount: usd(-1402),
                  fxRate: "1.1217",
                }),
                accountName: "Checking",
                categoryLabel: "Food",
                counterpartAccountName: null,
              },
            ] as HomeSummary["latest"],
          }),
        ),
      ]);
      expect(await screen.findByText("-€12.50")).toBeInTheDocument();
      expect(
        screen.getByText(
          (_, element) =>
            !!element?.classList.contains("base-note") &&
            element.textContent === "About -$14.02",
        ),
      ).toBeInTheDocument();
    });

    it("invites the first entry, with different words for a viewer", async () => {
      mount([ok(summary({ latest: [] }))]);
      expect(
        await screen.findByText("Use Add to record your first entry"),
      ).toBeInTheDocument();
      cleanup();
      mount([ok(summary({ latest: [] }))], { role: "viewer" });
      expect(
        await screen.findByText("No entries have been recorded yet"),
      ).toBeInTheDocument();
    });
  });

  it("removes every amount from the page in privacy mode", async () => {
    const { view } = mount([ok(summary())], { privacy: true });
    expect(await screen.findByText("In hand")).toBeInTheDocument();
    await screen.findByText("Corner Cafe");
    await screen.findByText("Checking");
    expect(view.container.textContent).not.toMatch(/\$|\d,\d|\d\.\d\d/);
    expect(screen.getAllByText("Amount hidden").length).toBeGreaterThanOrEqual(
      12,
    );
    for (const element of view.container.querySelectorAll(
      "[aria-label],[title]",
    ))
      expect(
        `${element.getAttribute("aria-label")}${element.getAttribute("title")}`,
      ).not.toMatch(/\$|\d[\d,]*\.\d\d/);
    expect(view.container.textContent).not.toContain("+");
  });

  it("guides a new owner to add the first account", async () => {
    mount([
      ok(
        summary({
          accounts: [],
          otherActive: { count: 0, balance: usd(0) },
          archived: { count: 0, balance: usd(0) },
          latest: [],
          setup: { hasActiveAccount: false, hasCategory: false },
        }),
      ),
    ]);
    expect(
      await screen.findByRole("heading", { name: "Add your first account" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Set up accounts" }),
    ).toHaveAttribute("href", "/accounts");
    expect(screen.queryByText("In hand")).not.toBeInTheDocument();
    expect(screen.queryByText("ROOM FOR WHAT MATTERS")).toBeNull();
  });

  it("gives viewers read-only wording and no write actions", async () => {
    mount(
      [
        ok(
          summary({
            accounts: [],
            latest: [],
            setup: { hasActiveAccount: false, hasCategory: false },
          }),
        ),
      ],
      { role: "viewer" },
    );
    expect(await screen.findByText(/Ask the ledger owner/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Set up accounts" })).toBeNull();
  });

  it("suggests categories when they are missing, and only to people who can add them", async () => {
    mount([
      ok(summary({ setup: { hasActiveAccount: true, hasCategory: false } })),
    ]);
    expect(
      await screen.findByRole("link", { name: /Set up categories/ }),
    ).toHaveAttribute("href", "/categories");
    cleanup();
    mount(
      [ok(summary({ setup: { hasActiveAccount: true, hasCategory: false } }))],
      { role: "viewer" },
    );
    expect(
      await screen.findByText("Categories haven't been set up yet."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Set up categories/ }),
    ).toBeNull();
  });

  it("shows honest zeroes when nothing was recorded this month", async () => {
    mount([
      ok(
        summary({
          moneyIn: usd(0),
          moneyOut: usd(0),
          owed: {
            total: usd(0),
            personCount: 0,
            otherCurrencies: [],
            unconvertedCurrencies: [],
          },
          loans: { lent: usd(0), borrowed: usd(0) },
          pendingCount: 0,
        }),
      ),
    ]);
    await screen.findByText("In hand");
    expect(screen.getAllByText("$0.00").length).toBeGreaterThanOrEqual(2);
  });

  it("explains an error and retries", async () => {
    const { fetcher } = mount([fail, ok(summary())]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load your overview.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("$3,590.00")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes("/home")),
    ).toHaveLength(2);
  });

  it("keeps the last numbers visible when a refresh fails", async () => {
    mount([ok(summary()), fail]);
    expect(await screen.findByText("$3,590.00")).toBeInTheDocument();
    await client.invalidateQueries({ queryKey: ["home"] });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Showing the last numbers");
    expect(screen.getByText("$3,590.00")).toBeInTheDocument();
    expect(
      within(alert.parentElement as HTMLElement).getByRole("button", {
        name: "Try again",
      }),
    ).toBeEnabled();
  });
});

describe("month helpers", () => {
  it("uses the local calendar month without UTC shifting", () => {
    expect(currentMonth(new Date(2026, 9, 31, 23, 59))).toBe("2026-10");
    expect(currentMonth(new Date(2026, 10, 1, 0, 0))).toBe("2026-11");
    expect(currentMonth(new Date(2027, 0, 1, 0, 0))).toBe("2027-01");
    expect(monthLabel("2026-10")).toBe("October 2026");
  });
});
