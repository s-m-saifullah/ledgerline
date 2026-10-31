import { type HomeSummary, newId } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentMonth } from "../../lib/month";
import { PrivacyContext } from "../../lib/preferences";
import { MorePage } from "./more-page";

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
function summary(over: Partial<HomeSummary> = {}): HomeSummary {
  return {
    month: currentMonth(),
    monthStart: "2026-10-01",
    monthEnd: "2026-10-31",
    inHand: usd(0),
    netWorth: usd(0),
    liabilitiesOwed: usd(0),
    accounts: [],
    otherActive: { count: 0, balance: usd(0) },
    archived: { count: 0, balance: usd(0) },
    moneyIn: usd(0),
    moneyOut: usd(0),
    owed: { total: usd(28000), personCount: 2 },
    loans: { lent: usd(60000), borrowed: usd(12500) },
    pendingCount: 0,
    latest: [],
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
function mount({
  home = summary(),
  homeFails = false,
  privacy = false,
}: {
  home?: HomeSummary;
  homeFails?: boolean;
  privacy?: boolean;
} = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/home"))
        return homeFails
          ? new Response("{}", { status: 500 })
          : new Response(JSON.stringify(home));
      return new Response(
        JSON.stringify({
          items: [
            {
              id: ledgerId,
              name: "Personal",
              role: "owner",
              baseCurrency: "USD",
              timeZone: "UTC",
              version: 1,
            },
          ],
        }),
      );
    }),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PrivacyContext value={privacy}>
        <MorePage />
      </PrivacyContext>
    </QueryClientProvider>,
  );
}
/** Home's summary has been asked for and answered, so a figure that is missing is missing for good. */
async function summaryLoaded() {
  await vi.waitFor(() => {
    const asked = vi
      .mocked(fetch)
      .mock.calls.some(([url]) => String(url).includes("/home"));
    expect(asked).toBe(true);
    expect(client.isFetching()).toBe(0);
  });
}
const group = (name: string) =>
  screen.getByRole("region", { name }) as HTMLElement;
const link = (name: RegExp | string) =>
  screen.getByRole("link", { name }) as HTMLElement;

describe("MorePage", () => {
  it("lists the pages in three groups, one row each, in the prototype's order", () => {
    mount();
    expect(
      screen.getByRole("heading", { level: 1, name: "More" }),
    ).toBeTruthy();
    const names = (region: string) =>
      within(group(region))
        .getAllByRole("link")
        .map((a) => a.querySelector(".ui-row-title")?.textContent);
    expect(names("Receivables and lending")).toEqual(["Clients", "Loans"]);
    expect(names("Money setup")).toEqual([
      "Accounts",
      "Categories",
      "Tags",
      "Currencies",
      "Recurring",
    ]);
    expect(names("Data and preferences")).toEqual([
      "Import and export",
      "Settings",
    ]);
    // The groups are headings, so a screen reader can jump between them, and Clients has its own icon.
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual([
      "Receivables and lending",
      "Money setup",
      "Data and preferences",
    ]);
    expect(link(/^Clients/).querySelector("svg.lucide-users")).toBeTruthy();
    expect(link(/^Accounts/).querySelector("svg.lucide-wallet")).toBeTruthy();
  });

  it("links each row to its page", () => {
    mount();
    for (const [name, to] of [
      ["Clients", "/clients"],
      ["Loans", "/loans"],
      ["Accounts", "/accounts"],
      ["Categories", "/categories"],
      ["Tags", "/tags"],
      ["Currencies", "/currencies"],
      ["Recurring", "/recurring"],
      ["Import and export", "/import"],
      ["Settings", "/settings"],
    ] as const)
      expect(link(new RegExp(`^${name}`)).getAttribute("href")).toBe(to);
  });

  it("gives every row an icon, a title and a chevron, and at most one short hint", () => {
    mount();
    const rows = screen
      .getAllByRole("link")
      .filter((a) => a.classList.contains("ui-row"));
    expect(rows).toHaveLength(9);
    for (const row of rows) {
      expect(row.querySelector(".ui-tile svg")).toBeTruthy();
      expect(row.querySelectorAll(".ui-row-title")).toHaveLength(1);
      expect(
        row.querySelectorAll(".ui-row-main .ui-row-hint").length,
      ).toBeLessThanOrEqual(1);
      expect(row.querySelector(".ui-row-chevron")).toBeTruthy();
      expect(
        row.querySelector(".ui-row-main .ui-row-hint")?.textContent?.length ??
          0,
      ).toBeLessThanOrEqual(40);
    }
  });

  it("says nothing under a page's name unless there is something to say, as the prototype does", async () => {
    mount({
      home: summary({
        owed: { total: usd(0), personCount: 0 },
        loans: { lent: usd(0), borrowed: usd(0) },
      } as Partial<HomeSummary>),
    });
    await summaryLoaded();
    const hinted = screen
      .getAllByRole("link")
      .filter((a) => a.querySelector(".ui-row-main .ui-row-hint"))
      .map((a) => a.querySelector(".ui-row-title")?.textContent);
    expect(hinted).toEqual(["Settings"]);
  });

  it("draws no eyebrow, subtitle or old card text", () => {
    mount();
    expect(screen.queryByText("MAKE IT YOURS")).toBeNull();
    expect(screen.queryByText("Your space.")).toBeNull();
    expect(
      screen.queryByText(/Your accounts, categories and clients/),
    ).toBeNull();
    expect(document.querySelector(".settings-card")).toBeNull();
    expect(screen.queryByTestId("app-version")).toBeNull();
  });

  it("shows who owes at the end of the Clients and Loans rows, from Home's summary", async () => {
    mount();
    const clients = link(/^Clients/);
    expect(await within(clients).findByText("$280.00")).toBeTruthy();
    expect(within(clients).getByText("2 clients owe you")).toBeTruthy();
    const loans = link(/^Loans/);
    expect(within(loans).getByText("$600.00")).toBeTruthy();
  });

  it("shows no figure on any other row", async () => {
    mount();
    await within(link(/^Clients/)).findByText("$280.00");
    const withFigures = screen
      .getAllByRole("link")
      .filter((a) => a.querySelector(".ui-row-end"))
      .map((a) => a.querySelector(".ui-row-title")?.textContent);
    expect(withFigures).toEqual(["Clients", "Loans"]);
  });

  it("leaves a figure of nothing out and says something short instead", async () => {
    mount({
      home: summary({
        owed: { total: usd(0), personCount: 0 },
        loans: { lent: usd(0), borrowed: usd(0) },
      } as Partial<HomeSummary>),
    });
    await summaryLoaded();
    expect(within(link(/^Clients/)).queryByText(/\$/)).toBeNull();
    expect(within(link(/^Clients/)).queryByText(/owe you/)).toBeNull();
    expect(within(link(/^Loans/)).queryByText(/\$/)).toBeNull();
  });

  it("says a single client owes you in the singular", async () => {
    mount({
      home: summary({
        owed: { total: usd(500), personCount: 1 },
      } as Partial<HomeSummary>),
    });
    expect(
      await within(link(/^Clients/)).findByText("1 client owes you"),
    ).toBeTruthy();
  });

  it("keeps every row when Home's summary cannot be loaded", async () => {
    mount({ homeFails: true });
    await summaryLoaded();
    expect(screen.getAllByRole("link").length).toBeGreaterThanOrEqual(9);
    expect(within(link(/^Clients/)).queryByText(/\$/)).toBeNull();
  });

  it("hides the figures in privacy mode", async () => {
    mount({ privacy: true });
    const clients = link(/^Clients/);
    expect(await within(clients).findByText("Amount hidden")).toBeTruthy();
    expect(within(clients).queryByText("$280.00")).toBeNull();
  });

  it("puts the version in the Settings row's hint instead of a line at the foot", () => {
    mount();
    expect(link(/^Settings/).textContent).toContain("Version 0.0.0-test");
  });
});
