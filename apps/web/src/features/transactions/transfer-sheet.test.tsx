import {
  type Account,
  newId,
  type RateLookup,
  type Transfer,
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
import { afterEach, expect, it, vi } from "vitest";
import { json, ledgerId } from "../../test-support/category-fixtures";
import { TransferForm } from "./transfer-form";

const stamp = "2026-10-07T00:00:00.000Z";
const account = (
  name: string,
  currency: string,
  extra: Partial<Account> = {},
): Account => ({
  id: newId(),
  ledgerId,
  name,
  type: "bank",
  currency,
  openingBalance: { amount: 0, currency },
  inboundBonusBps: null,
  bonusCategoryId: null,
  feeCategoryId: null,
  defaultFee: null,
  contactId: null,
  balance: { amount: 0, currency },
  archivedAt: null,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
  ...extra,
});
const bank = account("Bank", "USD");
const cash = account("Cash", "USD");
const euros = account("Euros", "EUR");
const taka = account("Taka", "BDT");
const moreTaka = account("More taka", "BDT");
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
  extra: Partial<Transfer> = {},
): Transfer => ({
  id: newId(),
  ledgerId,
  fromAccountId: from.id,
  toAccountId: to.id,
  fromTransactionId: newId(),
  toTransactionId: newId(),
  amount: { amount: 10000, currency: from.currency },
  receivedAmount: { amount: 10000, currency: to.currency },
  baseAmount: { amount: 10000, currency: "USD" },
  bonus: null,
  fee: null,
  tags: [],
  date: "2026-10-07",
  time: null,
  note: null,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
  ...extra,
});
const linked = (amount: number) => ({
  transactionId: newId(),
  amount: { amount, currency: "USD" },
  categoryId: newId(),
  deletedAt: null,
});
let queryClient: QueryClient;
afterEach(() => {
  cleanup();
  queryClient?.clear();
  vi.unstubAllGlobals();
  localStorage.clear();
});
function mount(
  accounts: Account[],
  extra: Partial<Parameters<typeof TransferForm>[0]> = {},
) {
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    const target = String(url);
    if (init?.method === "POST")
      return json(saved(accounts[0] as Account, accounts[1] as Account), 201);
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (target.includes("/exchange-rates/lookup")) return json(lookup);
    if (target.endsWith("/currencies"))
      return json({ baseCurrency: "USD", items: [] });
    return json({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onSaved = vi.fn();
  const onDeleted = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <TransferForm
        actorId={newId()}
        ledgerId={ledgerId}
        accounts={accounts}
        open
        writable
        onDismiss={vi.fn()}
        onSaved={onSaved}
        onDeleted={onDeleted}
        onLock={vi.fn()}
        {...extra}
      />
    </QueryClientProvider>,
  );
  return { fetchMock, onSaved, onDeleted };
}
const sent = (
  fetchMock: ReturnType<typeof mount>["fetchMock"],
  method: string,
) =>
  JSON.parse(
    String(
      fetchMock.mock.calls.find(([, init]) => init?.method === method)?.[1]
        ?.body,
    ),
  );
const swap = () => screen.getByRole("button", { name: "Swap accounts" });
async function choose(from: Account, to: Account) {
  await userEvent.selectOptions(screen.getByLabelText("From account"), from.id);
  await userEvent.selectOptions(screen.getByLabelText("To account"), to.id);
}

it("swaps From and To and keeps the amount between two accounts of one currency", async () => {
  const { fetchMock, onSaved } = mount([bank, cash]);
  await choose(bank, cash);
  await userEvent.type(screen.getByLabelText("Amount (USD)"), "25");
  await userEvent.click(swap());
  expect(screen.getByLabelText("From account")).toHaveValue(cash.id);
  expect(screen.getByLabelText("To account")).toHaveValue(bank.id);
  expect(screen.getByLabelText("Amount (USD)")).toHaveValue("25");
  await userEvent.click(screen.getByRole("button", { name: "Save transfer" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(sent(fetchMock, "POST")).toMatchObject({
    fromAccountId: cash.id,
    toAccountId: bank.id,
    amount: { amount: 2500, currency: "USD" },
  });
});

it("swaps the currencies with the accounts and each figure stays with its currency", async () => {
  mount([bank, euros]);
  await choose(bank, euros);
  await userEvent.type(screen.getByLabelText("Amount sent (USD)"), "100");
  await userEvent.type(screen.getByLabelText("Amount received (EUR)"), "89");
  await userEvent.click(swap());
  expect(screen.getByLabelText("From account")).toHaveValue(euros.id);
  expect(screen.getByLabelText("To account")).toHaveValue(bank.id);
  expect(screen.getByLabelText("Amount sent (EUR)")).toHaveValue("89");
  expect(screen.getByLabelText("Amount received (USD)")).toHaveValue("100");
  expect(await screen.findByText("1 USD = 0.89 EUR")).toBeInTheDocument();
});

it("clears a rate set by hand when the accounts are swapped", async () => {
  const { fetchMock, onSaved } = mount([euros, taka]);
  await choose(euros, taka);
  await userEvent.type(screen.getByLabelText("Amount sent (EUR)"), "100");
  await userEvent.type(screen.getByLabelText("Amount received (BDT)"), "13700");
  await userEvent.click(
    await screen.findByRole("button", { name: "Set the rate yourself" }),
  );
  const field = screen.getByLabelText("1 USD is worth (EUR)");
  await userEvent.clear(field);
  await userEvent.type(field, "1.25");
  await userEvent.click(swap());
  await userEvent.click(screen.getByRole("button", { name: "Save transfer" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(sent(fetchMock, "POST")).toMatchObject({
    fromAccountId: taka.id,
    toAccountId: euros.id,
    amount: { amount: 1370000, currency: "BDT" },
    receivedAmount: { amount: 10000, currency: "EUR" },
  });
  expect(sent(fetchMock, "POST").fxRate).toBeUndefined();
});

it("checks the figures again after a swap once a save has been tried, so no message is left for the old way round", async () => {
  mount([bank, euros]);
  await choose(bank, euros);
  await userEvent.type(screen.getByLabelText("Amount sent (USD)"), "100");
  await userEvent.click(screen.getByRole("button", { name: "Save transfer" }));
  expect(
    await screen.findByText("Enter how much arrives in EUR."),
  ).toBeInTheDocument();
  await userEvent.click(swap());
  await waitFor(() =>
    expect(
      screen.queryByText("Enter how much arrives in EUR."),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText("Amount sent (EUR)")).toHaveValue("");
  expect(screen.getByLabelText("Amount received (USD)")).toHaveValue("100");
});

it("offers the swap only where both accounts can move: not with an archived one, not read-only", () => {
  const old = account("Old", "USD", { archivedAt: stamp });
  mount([old, cash], { transfer: saved(old, cash) });
  expect(swap()).toBeDisabled();
  cleanup();
  mount([cash, old], { transfer: saved(cash, old) });
  expect(swap()).toBeDisabled();
  cleanup();
  mount([bank, cash], { transfer: saved(bank, cash) });
  expect(swap()).toBeEnabled();
  cleanup();
  mount([bank, cash], { transfer: saved(bank, cash), writable: false });
  expect(swap()).toBeDisabled();
});

it("keeps the swap off until there are two accounts to swap", () => {
  mount([bank]);
  expect(swap()).toBeDisabled();
});

it("asks before deleting in a centred question that holds the bonus and fee choices", async () => {
  const { fetchMock, onDeleted } = mount([bank, cash], {
    transfer: saved(bank, cash, { bonus: linked(250), fee: linked(200) }),
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Delete transfer" }),
  );
  const question = await screen.findByRole("dialog", {
    name: "Delete this transfer?",
  });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(
    within(question).getByLabelText("Also delete its bonus entry"),
  ).toBeChecked();
  expect(
    within(question).getByLabelText("Also delete its fee entry"),
  ).toBeChecked();
  await userEvent.click(
    within(question).getByRole("button", { name: "Keep transfer" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Delete this transfer?" }),
    ).not.toBeInTheDocument(),
  );
  expect(fetchMock).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Delete transfer" }),
  );
  const again = await screen.findByRole("dialog", {
    name: "Delete this transfer?",
  });
  await userEvent.click(
    within(again).getByLabelText("Also delete its bonus entry"),
  );
  await userEvent.click(
    within(again).getByRole("button", { name: "Confirm delete" }),
  );
  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  expect(sent(fetchMock, "DELETE")).toMatchObject({ deleteFee: true });
  expect(sent(fetchMock, "DELETE").deleteBonus).toBeFalsy();
});

it("asks only about the entries a transfer has", async () => {
  mount([bank, cash], { transfer: saved(bank, cash) });
  await userEvent.click(
    screen.getByRole("button", { name: "Delete transfer" }),
  );
  const question = await screen.findByRole("dialog", {
    name: "Delete this transfer?",
  });
  expect(within(question).queryByRole("checkbox")).toBeNull();
  expect(
    within(question).getByText(/Both legs will be deleted/),
  ).toBeInTheDocument();
});

it("keeps the sheet's own foot to Save and Delete while the question is shut", async () => {
  mount([bank, cash], { transfer: saved(bank, cash) });
  expect(
    screen.queryByRole("button", { name: "Confirm delete" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Keep transfer" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Save changes" }),
  ).toBeInTheDocument();
});

it("has no fee or bonus fields on an edit", () => {
  mount([bank, cash], { transfer: saved(bank, cash) });
  expect(screen.queryByLabelText("Fee (optional)")).toBeNull();
  expect(screen.queryByText(/^More/)).toBeNull();
});

it("shows the bonus as a switch with its rate beside it", async () => {
  mount([bank, account("Wallet", "USD", { inboundBonusBps: 250 })]);
  const row = screen.getByRole("switch", { name: "Add a bonus" });
  expect(row).toBeChecked();
  expect(row).toHaveAccessibleDescription("2.5% of what arrives");
  await userEvent.click(row);
  expect(row).not.toBeChecked();
  expect(screen.queryByLabelText("Bonus (USD)")).toBeNull();
});

it("says in one line that a saved transfer's bonus is edited from the list", () => {
  mount([bank, cash], {
    transfer: saved(bank, cash, { bonus: linked(250) }),
  });
  expect(screen.getByText(/Its bonus is separate income/)).toBeInTheDocument();
  expect(screen.queryByText(/Its fee is a separate expense/)).toBeNull();
});

it("does not complain about an empty form just because it was swapped", async () => {
  mount([bank, euros]);
  await choose(bank, euros);
  await userEvent.click(swap());
  expect(screen.queryByText(/Enter how much arrives/)).toBeNull();
  expect(screen.queryByText(/Enter an amount/)).toBeNull();
  expect(document.querySelector(".field-error")).toBeNull();
});

it("clears a rate set by hand when either account is changed", async () => {
  const { fetchMock, onSaved } = mount([euros, taka, moreTaka]);
  await choose(euros, taka);
  await userEvent.type(screen.getByLabelText("Amount sent (EUR)"), "100");
  await userEvent.type(screen.getByLabelText("Amount received (BDT)"), "13700");
  await userEvent.click(
    await screen.findByRole("button", { name: "Set the rate yourself" }),
  );
  const field = screen.getByLabelText("1 USD is worth (EUR)");
  await userEvent.clear(field);
  await userEvent.type(field, "1.25");
  await userEvent.selectOptions(
    screen.getByLabelText("To account"),
    moreTaka.id,
  );
  await userEvent.click(screen.getByRole("button", { name: "Save transfer" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(sent(fetchMock, "POST").fxRate).toBeUndefined();
});

it("lists an archived account of a saved transfer in its own field, but does not let it be chosen", () => {
  const old = account("Old", "USD", { archivedAt: stamp });
  mount([old, cash], { transfer: saved(old, cash) });
  const from = within(screen.getByLabelText("From account"));
  const to = within(screen.getByLabelText("To account"));
  expect(from.getByRole("option", { name: "Old (archived)" })).toBeDisabled();
  expect(to.queryByRole("option", { name: /Old/ })).toBeNull();
});
