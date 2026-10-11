import { type Account, newId, type RateLookup } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  category,
  chooseCategory,
  json,
  ledgerId,
} from "../categories/fixtures.test-helper";
import { QuickAddForm } from "./quick-add";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

const expense = category("Food");
const stamp = "2026-10-07T00:00:00.000Z";
const account = (name: string, currency: string): Account => ({
  id: newId(),
  ledgerId,
  name,
  type: "bank",
  currency,
  openingBalance: { amount: 0, currency },
  balance: { amount: 0, currency },
  archivedAt: null,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
});
const euro = account("Euro bank", "EUR");
const dollars = account("Dollar bank", "USD");
const lookup = (rate: string | null): RateLookup => ({
  code: "EUR",
  date: "2026-10-07",
  baseCurrency: "USD",
  rate,
  rateDate: rate ? "2026-10-02" : null,
  source: rate ? "manual" : null,
});
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
  localStorage.clear();
});
function mount(rate: string | null, accounts = [euro, dollars]) {
  const saved = {
    id: newId(),
    ledgerId,
    accountId: euro.id,
    categoryId: expense.id,
    kind: "expense",
    date: "2026-10-07",
    time: null,
    amount: { amount: -10000, currency: "EUR" },
    baseAmount: { amount: -11217, currency: "USD" },
    fxRate: "1.1217",
    transferId: null,
    receivablePaymentId: null,
    receivableId: null,
    isSplit: false,
    splits: [],
    payee: null,
    note: null,
    status: "cleared",
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
  };
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    const target = String(url);
    if (init?.method === "POST") return json(saved, 201);
    if (target.includes("/exchange-rates/lookup")) return json(lookup(rate));
    if (target.endsWith("/currencies"))
      return json({ baseCurrency: "USD", items: [] });
    return json({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <QuickAddForm
        actorId={newId()}
        ledgerId={ledgerId}
        accounts={accounts}
        categories={[expense]}
        writable
        blocked={false}
        open
        onDismiss={vi.fn()}
        onSaved={onSaved}
        onCategorySaved={vi.fn()}
        onRefresh={vi.fn(async () => {})}
      />
    </QueryClientProvider>,
  );
  return { fetchMock, onSaved };
}
const posts = (fetchMock: ReturnType<typeof mount>["fetchMock"]) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

it("enters an amount in the account's currency and shows its base value and rate", async () => {
  const { fetchMock, onSaved } = mount("1.1217");
  // The first active account is the euro one, so the amount is in euros.
  expect(screen.getByLabelText("Amount (EUR)")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Amount (EUR)"), "100");
  await chooseCategory("Category", expense.name);
  expect(await screen.findByText(/About/)).toHaveTextContent(
    "About $112.17 · 1 USD = 0.891504 EUR (rate from 2026-10-02)",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Save transaction" }),
  );
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  // No rate was set by hand, so none is sent; the server uses the stored one.
  const body = JSON.parse(String(posts(fetchMock)[0]?.[1]?.body));
  expect(body.amount).toEqual({ amount: -10000, currency: "EUR" });
  expect(body.fxRate).toBeUndefined();
});

it("sends a rate set by hand, read base-currency first", async () => {
  const { fetchMock, onSaved } = mount("1.1217");
  await userEvent.type(screen.getByLabelText("Amount (EUR)"), "100");
  await chooseCategory("Category", expense.name);
  await userEvent.click(
    await screen.findByRole("button", { name: "Set the rate yourself" }),
  );
  const field = screen.getByLabelText("1 USD is worth (EUR)");
  expect(field).toHaveValue("0.891504");
  await userEvent.clear(field);
  await userEvent.type(field, "1.25");
  // 1 USD = 1.25 EUR means 1 EUR = 0.8 USD, so 100 EUR is 80 USD.
  expect(await screen.findByText(/About/)).toHaveTextContent(
    "About $80.00 · 1 USD = 1.25 EUR (set by you)",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Save transaction" }),
  );
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(JSON.parse(String(posts(fetchMock)[0]?.[1]?.body)).fxRate).toBe("0.8");
});

it("says so when no rate is stored, and rejects a bad hand-set rate", async () => {
  mount(null);
  await userEvent.type(screen.getByLabelText("Amount (EUR)"), "100");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "No EUR rate is stored for this date yet",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Set the rate yourself" }),
  );
  await userEvent.type(screen.getByLabelText("1 USD is worth (EUR)"), "abc");
  expect(
    await screen.findByText("Enter a positive amount such as 122.5."),
  ).toBeInTheDocument();
});

it("follows the chosen account: another currency, a clean rate, no rate field for dollars", async () => {
  const { fetchMock } = mount("1.1217");
  await userEvent.type(screen.getByLabelText("Amount (EUR)"), "100");
  await userEvent.click(
    await screen.findByRole("button", { name: "Set the rate yourself" }),
  );
  await userEvent.type(screen.getByLabelText("1 USD is worth (EUR)"), "9");
  await userEvent.selectOptions(screen.getByLabelText("Account"), dollars.id);
  expect(screen.getByLabelText("Amount (USD)")).toBeInTheDocument();
  expect(screen.queryByText(/About/)).toBeNull();
  expect(screen.queryByLabelText(/is worth/)).toBeNull();
  await chooseCategory("Category", expense.name);
  await userEvent.click(
    screen.getByRole("button", { name: "Save transaction" }),
  );
  await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
  const body = JSON.parse(String(posts(fetchMock)[0]?.[1]?.body));
  expect(body.amount.currency).toBe("USD");
  expect(body.fxRate).toBeUndefined();
});
