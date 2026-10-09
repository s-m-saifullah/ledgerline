import { type HomeSummary, newId } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { currentMonth } from "../home/month";
import { PrivacyContext } from "../shell/preferences";
import { NetWorthCard } from "./net-worth-card";

const usd = (amount: number) => ({ amount, currency: "USD" as const });
const group = { count: 0, balance: usd(0) };
function summary(over: Partial<HomeSummary> = {}) {
  return {
    month: currentMonth(),
    monthStart: "2026-10-01",
    monthEnd: "2026-10-31",
    inHand: usd(359000),
    netWorth: usd(388725),
    liabilitiesOwed: usd(39000),
    accounts: [],
    otherActive: group,
    archived: group,
    moneyIn: usd(0),
    moneyOut: usd(0),
    owed: { total: usd(0), personCount: 0 },
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
function mount(body: HomeSummary, privacy = false) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body))),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PrivacyContext value={privacy}>
        <NetWorthCard ledgerId={newId()} />
      </PrivacyContext>
    </QueryClientProvider>,
  );
}

it("shows net worth with its explanation and the owed-on-cards-and-loans subtotal", async () => {
  mount(summary());
  expect(await screen.findByText("Net worth")).toBeInTheDocument();
  expect(screen.getByText("$3,887.25")).toBeInTheDocument();
  expect(screen.getByText("Owed on cards and loans")).toBeInTheDocument();
  expect(screen.getByText("$390.00")).toBeInTheDocument();
  expect(screen.getByText(/including archived ones/)).toBeInTheDocument();
});
it("removes the amounts in privacy mode", async () => {
  const view = mount(summary(), true);
  expect(await screen.findByText("Net worth")).toBeInTheDocument();
  expect(view.container.textContent).not.toMatch(/\$|\d,\d|\d\.\d\d/);
  expect(screen.getAllByText("Amount hidden")).toHaveLength(2);
});
it("stays out of the way until an account exists", async () => {
  const view = mount(
    summary({ setup: { hasActiveAccount: false, hasCategory: false } }),
  );
  await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
  expect(view.container).toBeEmptyDOMElement();
});
