import { type HomeSummary, newId } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivacyContext } from "../shell/preferences";
import { HomePage } from "./home-page";
import { currentMonth, monthLabel } from "./month";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    className,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className} {...rest}>
      {children}
    </a>
  ),
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
    receivablePaymentId: null,
    receivableId: null,
    isSplit: false,
    splits: [],
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
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
});
function mount(
  responses: (() => Response | Promise<Response>)[],
  { role = "owner", privacy = false } = {},
) {
  let home = 0;
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    if (String(url).includes("/home")) {
      const respond = responses[Math.min(home, responses.length - 1)];
      home++;
      return (respond as () => Response)();
    }
    return new Response(
      JSON.stringify({
        items: [{ id: ledgerId, name: "Personal", baseCurrency: "USD", role }],
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
    {
      status: 500,
    },
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
    expect(screen.getByText("$2,650.00")).toBeInTheDocument();
    expect(screen.getByText("$147.75")).toBeInTheDocument();
    expect(screen.getByText("$280.00")).toBeInTheDocument();
    expect(screen.getByText("From 2 people")).toBeInTheDocument();
    expect(
      screen.getByText("1 pending entry isn't counted yet."),
    ).toBeInTheDocument();
    expect(screen.getByText("$3,540.00")).toBeInTheDocument();
    expect(screen.getByText("-$25.00")).toBeInTheDocument();
    expect(screen.getByText("Bank · Overdrawn")).toBeInTheDocument();
    // Net worth, cards and loans are not on Home; In hand is.
    expect(screen.getByText("In hand")).toBeInTheDocument();
    expect(screen.queryByText("Net worth")).not.toBeInTheDocument();
    expect(screen.queryByText("$3,887.25")).not.toBeInTheDocument();
    expect(screen.queryByText(/Visa|Card ·|Loan ·/)).not.toBeInTheDocument();
    expect(screen.getByText("2 other accounts")).toBeInTheDocument();
    expect(screen.getByText("Archived accounts")).toBeInTheDocument();
    expect(screen.getByText(/Transfer · Checking → Cash/)).toBeInTheDocument();
    expect(screen.getByText("Corner Cafe")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Owed to you/ })).toHaveAttribute(
      "href",
      "/more/people",
    );
    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute(
      "href",
      "/transactions",
    );
  });

  it("shows foreign accounts and entries in their own currency with the base value beside them", async () => {
    const euro = newId();
    const yen = newId();
    mount([
      ok(
        summary({
          accounts: [
            {
              id: euro,
              name: "Euro bank",
              type: "bank",
              balance: { amount: 100000, currency: "EUR" },
              baseBalance: usd(112170),
            },
            {
              id: yen,
              name: "Yen wallet",
              type: "wallet",
              balance: { amount: 5000, currency: "JPY" },
              baseBalance: null,
            },
          ],
          otherActive: { count: 0, balance: usd(0) },
          archived: { count: 0, balance: usd(0) },
          unconvertedCurrencies: ["JPY"],
          latest: [
            {
              transaction: entry({
                payee: "Cafe Paris",
                amount: { amount: -1250, currency: "EUR" },
                baseAmount: usd(-1402),
                fxRate: "1.1217",
              }),
              accountName: "Euro bank",
              categoryLabel: "Food",
              counterpartAccountName: null,
            },
          ] as HomeSummary["latest"],
        }),
      ),
    ]);
    const note = (text: string) =>
      screen.getByText(
        (_, element) =>
          !!element?.classList.contains("base-note") &&
          element.textContent === text,
      );
    expect(await screen.findByText("€1,000.00")).toBeInTheDocument();
    expect(note("About $1,121.70")).toBeInTheDocument();
    expect(screen.getByText("¥5,000")).toBeInTheDocument();
    expect(screen.getByText("-€12.50")).toBeInTheDocument();
    expect(note("About -$14.02")).toBeInTheDocument();
    // The yen account has no rate yet, so Home says so and links to where to add one.
    const missing = screen.getByRole("note");
    expect(missing).toHaveTextContent("JPY has no exchange rate yet");
    expect(
      within(missing).getByRole("link", { name: "Add a rate" }),
    ).toHaveAttribute("href", "/more/currencies");
  });

  it("removes every amount from the page in privacy mode", async () => {
    const { view } = mount([ok(summary())], { privacy: true });
    expect(await screen.findByText("In hand")).toBeInTheDocument();
    await screen.findByText("Corner Cafe");
    expect(view.container.textContent).not.toMatch(/\$|\d,\d|\d\.\d\d/);
    expect(screen.getAllByText("Amount hidden").length).toBeGreaterThanOrEqual(
      9,
    );
    for (const element of view.container.querySelectorAll(
      "[aria-label],[title]",
    ))
      expect(
        `${element.getAttribute("aria-label")}${element.getAttribute("title")}`,
      ).not.toMatch(/\$|\d[\d,]*\.\d\d/);
    // Counts are not amounts.
    expect(screen.getByText("From 2 people")).toBeInTheDocument();
  });

  it("explains when there are only cards or loans and no money accounts", async () => {
    mount([
      ok(
        summary({
          inHand: usd(0),
          accounts: [],
          otherActive: { count: 0, balance: usd(0) },
          archived: { count: 0, balance: usd(0) },
        }),
      ),
    ]);
    expect(
      await screen.findByText("No bank, cash, wallet or savings accounts yet."),
    ).toBeInTheDocument();
    expect(screen.getByText("In hand")).toBeInTheDocument();
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
    ).toHaveAttribute("href", "/more/accounts");
    expect(screen.queryByText("In hand")).not.toBeInTheDocument();
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

  it("suggests categories and the first entry when they are missing", async () => {
    mount([
      ok(
        summary({
          latest: [],
          setup: { hasActiveAccount: true, hasCategory: false },
        }),
      ),
    ]);
    expect(
      await screen.findByRole("link", { name: "Set up categories" }),
    ).toHaveAttribute("href", "/more/categories");
    expect(
      screen.getByText("Use Add to record your first entry"),
    ).toBeInTheDocument();
  });

  it("shows honest zeroes when nothing was recorded this month", async () => {
    mount([
      ok(
        summary({
          moneyIn: usd(0),
          moneyOut: usd(0),
          owed: { total: usd(0), personCount: 0 },
          pendingCount: 0,
        }),
      ),
    ]);
    expect(
      await screen.findByText("Nobody owes you right now"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("$0.00")).toHaveLength(3);
    expect(
      screen.queryByText(/pending entr(y|ies) (isn't|aren't) counted/),
    ).toBeNull();
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
