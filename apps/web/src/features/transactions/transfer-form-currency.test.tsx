import {
  type Account,
  newId,
  type RateLookup,
  type Transfer,
} from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { json, ledgerId } from "../categories/fixtures.test-helper";
import { TransferForm } from "./transfer-form";

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
const dollars = account("Dollars", "USD");
const euros = account("Euros", "EUR");
const moreEuros = account("More euros", "EUR");
const taka = account("Taka", "BDT");
const lookup: RateLookup = {
  code: "EUR",
  date: "2026-10-07",
  baseCurrency: "USD",
  rate: "1.1217",
  rateDate: "2026-10-02",
  source: "manual",
};
const saved = (
  from: Account,
  to: Account,
  amount: number,
  received: number,
): Transfer => ({
  id: newId(),
  ledgerId,
  fromAccountId: from.id,
  toAccountId: to.id,
  fromTransactionId: newId(),
  toTransactionId: newId(),
  amount: { amount, currency: from.currency },
  receivedAmount: { amount: received, currency: to.currency },
  baseAmount: { amount: 10000, currency: "USD" },
  date: "2026-10-07",
  time: null,
  note: null,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
});
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
  localStorage.clear();
});
function mount(from: Account, to: Account) {
  const reply = saved(from, to, 10000, 8900);
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    const target = String(url);
    if (init?.method === "POST") return json(reply, 201);
    if (target.includes("/exchange-rates/lookup")) return json(lookup);
    if (target.endsWith("/currencies"))
      return json({ baseCurrency: "USD", items: [] });
    return json({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <TransferForm
        actorId={newId()}
        ledgerId={ledgerId}
        accounts={[from, to]}
        open
        writable
        onDismiss={vi.fn()}
        onSaved={onSaved}
        onLock={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { fetchMock, onSaved };
}
const body = (fetchMock: ReturnType<typeof mount>["fetchMock"]) =>
  JSON.parse(
    String(
      fetchMock.mock.calls.find(([, init]) => init?.method === "POST")?.[1]
        ?.body,
    ),
  );
async function choose(from: Account, to: Account) {
  await userEvent.selectOptions(screen.getByLabelText("From account"), from.id);
  await userEvent.selectOptions(screen.getByLabelText("To account"), to.id);
}

it("asks what arrives when the accounts use different currencies, and shows the rate the amounts imply", async () => {
  const { fetchMock, onSaved } = mount(dollars, euros);
  await choose(dollars, euros);
  expect(screen.getByLabelText("Amount sent (USD)")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Amount sent (USD)"), "100");
  await userEvent.type(screen.getByLabelText("Amount received (EUR)"), "89");
  expect(await screen.findByText("1 USD = 0.89 EUR")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Save transfer" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(body(fetchMock)).toMatchObject({
    fromAccountId: dollars.id,
    toAccountId: euros.id,
    amount: { amount: 10000, currency: "USD" },
    receivedAmount: { amount: 8900, currency: "EUR" },
  });
  // USD sets the value, so no rate is sent.
  expect(body(fetchMock).fxRate).toBeUndefined();
});

it("requires the received amount between currencies and rejects a bad one", async () => {
  const { fetchMock } = mount(dollars, euros);
  await choose(dollars, euros);
  await userEvent.type(screen.getByLabelText("Amount sent (USD)"), "100");
  await userEvent.click(screen.getByRole("button", { name: "Save transfer" }));
  expect(
    await screen.findByText("Enter how much arrives in EUR."),
  ).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Amount received (EUR)"), "0");
  await userEvent.click(screen.getByRole("button", { name: "Save transfer" }));
  expect(
    await screen.findByText("Enter how much arrives in EUR."),
  ).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
    false,
  );
});

it("takes the rate from the sent currency when neither account is in USD, and sends one set by hand", async () => {
  const { fetchMock, onSaved } = mount(euros, taka);
  await choose(euros, taka);
  await userEvent.type(screen.getByLabelText("Amount sent (EUR)"), "100");
  await userEvent.type(screen.getByLabelText("Amount received (BDT)"), "13700");
  expect(await screen.findByText(/About/)).toHaveTextContent(
    "About $112.17 · 1 USD = 0.891504 EUR (rate from 2026-10-02)",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Set the rate yourself" }),
  );
  const field = screen.getByLabelText("1 USD is worth (EUR)");
  await userEvent.clear(field);
  await userEvent.type(field, "1.25");
  await userEvent.click(screen.getByRole("button", { name: "Save transfer" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(body(fetchMock)).toMatchObject({
    amount: { amount: 10000, currency: "EUR" },
    receivedAmount: { amount: 1370000, currency: "BDT" },
    fxRate: "0.8",
  });
});

it("has one amount when both accounts share a currency", async () => {
  const { fetchMock, onSaved } = mount(euros, moreEuros);
  await choose(euros, moreEuros);
  expect(screen.getByLabelText("Amount (EUR)")).toBeInTheDocument();
  expect(screen.queryByLabelText(/Amount received/)).toBeNull();
  await userEvent.type(screen.getByLabelText("Amount (EUR)"), "50");
  await userEvent.click(screen.getByRole("button", { name: "Save transfer" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(body(fetchMock).receivedAmount).toBeUndefined();
  expect(body(fetchMock).amount).toEqual({ amount: 5000, currency: "EUR" });
});
