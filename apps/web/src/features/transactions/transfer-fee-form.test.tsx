import { type Account, newId, type Transfer } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  category,
  chooseCategory,
  json,
  ledgerId,
} from "../../test-support/category-fixtures";
import { TransferForm } from "./transfer-form";

const fees = category("Fees"),
  salary = category("Salary", { kind: "income" });
const account = (name: string, extra: Partial<Account> = {}) =>
  ({
    id: newId(),
    ledgerId,
    name,
    type: "bank",
    currency: "USD",
    archivedAt: null,
    inboundBonusBps: null,
    bonusCategoryId: null,
    feeCategoryId: null,
    defaultFee: null,
    contactId: null,
    ...extra,
  }) as Account;
const bank = account("Bank"),
  cash = account("Cash");
const saved = (extra: Partial<Transfer> = {}): Transfer => ({
  id: newId(),
  ledgerId,
  fromAccountId: bank.id,
  toAccountId: cash.id,
  fromTransactionId: newId(),
  toTransactionId: newId(),
  amount: { amount: 10000, currency: "USD" },
  receivedAmount: { amount: 10000, currency: "USD" },
  baseAmount: { amount: 10000, currency: "USD" },
  bonus: null,
  fee: null,
  tags: [],
  date: "2026-10-07",
  time: null,
  note: null,
  version: 1,
  createdAt: "2026-10-07T00:00:00Z",
  updatedAt: "2026-10-07T00:00:00Z",
  ...extra,
});
const props = {
  ledgerId,
  actorId: "actor",
  accounts: [bank, cash],
  categories: [fees, salary],
  open: true,
  writable: true,
  onDismiss: vi.fn(),
  onSaved: vi.fn(),
  onDeleted: vi.fn(),
  onLock: vi.fn(),
};
const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });
const view = (extra: object = {}) =>
  render(
    <QueryClientProvider client={client()}>
      <TransferForm {...props} {...extra} />
    </QueryClientProvider>,
  );
const requestBody = (fetchMock: ReturnType<typeof vi.fn>) =>
  JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
});

it("explains the one Fee box and previews what leaves the sending account", async () => {
  view();
  expect(
    screen.getByText(
      /Type 2 for a fixed fee, or 2% for a percentage of the amount sent\./,
    ),
  ).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Amount (USD)"), "100");
  const fee = screen.getByLabelText("Fee (optional)");
  await userEvent.type(fee, "2");
  const preview = document.getElementById("transfer-fee-preview");
  await waitFor(() =>
    expect(preview).toHaveTextContent("Fee $2.00 · $102.00 leaves Bank"),
  );
  await userEvent.clear(fee);
  await userEvent.type(fee, "1.5%");
  await waitFor(() =>
    expect(preview).toHaveTextContent("Fee $1.50 · $101.50 leaves Bank"),
  );
  await userEvent.clear(fee);
  expect(screen.queryByText(/leaves/)).not.toBeInTheDocument();
});

it("sends a plain number as a fixed fee in the sending currency", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    json(
      saved({
        fee: {
          transactionId: newId(),
          amount: { amount: 200, currency: "USD" },
          categoryId: fees.id,
          deletedAt: null,
        },
      }),
      201,
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  view();
  await userEvent.type(screen.getByLabelText("Amount (USD)"), "100");
  await userEvent.type(screen.getByLabelText("Fee (optional)"), "2");
  await userEvent.click(screen.getByText(/^More/));
  await chooseCategory("Fee category", "Fees");
  await userEvent.click(screen.getByRole("button", { name: "Save transfer" }));
  await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
  expect(requestBody(fetchMock)).toMatchObject({
    amount: { amount: 10000, currency: "USD" },
    fee: { amount: { amount: 200, currency: "USD" }, categoryId: fees.id },
  });
  expect(props.onSaved.mock.calls[0]?.[1]).toEqual({ bonus: false, fee: true });
});

it("sends a number with % as basis points and leaves the fee out when the box is empty", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => json(saved(), 201));
  vi.stubGlobal("fetch", fetchMock);
  view();
  await userEvent.type(screen.getByLabelText("Amount (USD)"), "100");
  await userEvent.type(screen.getByLabelText("Fee (optional)"), "1.5%");
  await userEvent.click(screen.getByText(/^More/));
  await chooseCategory("Fee category", "Fees");
  await userEvent.click(screen.getByRole("button", { name: "Save transfer" }));
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledTimes(1));
  expect(requestBody(fetchMock).fee).toEqual({
    basisPoints: 150,
    categoryId: fees.id,
  });
  cleanup();
  fetchMock.mockClear();
  view();
  await userEvent.type(screen.getByLabelText("Amount (USD)"), "100");
  await userEvent.click(screen.getByRole("button", { name: "Save transfer" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(requestBody(fetchMock)).not.toHaveProperty("fee");
});

it("starts from the sending account's remembered fee and category", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => json(saved(), 201));
  vi.stubGlobal("fetch", fetchMock);
  const remembering = account("Wallet", {
    defaultFee: { basisPoints: 150 },
    feeCategoryId: fees.id,
  });
  view({ accounts: [remembering, cash] });
  expect(screen.getByLabelText("Fee (optional)")).toHaveValue("1.5%");
  await userEvent.type(screen.getByLabelText("Amount (USD)"), "100");
  await userEvent.click(screen.getByRole("button", { name: "Save transfer" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(requestBody(fetchMock).fee).toEqual({
    basisPoints: 150,
    categoryId: fees.id,
  });
});

it("opens More and asks for a category when a fee has none", async () => {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  view();
  await userEvent.type(screen.getByLabelText("Amount (USD)"), "100");
  await userEvent.type(screen.getByLabelText("Fee (optional)"), "2");
  expect(screen.getByText(/^More/).closest("details")).toHaveAttribute("open");
  await userEvent.click(screen.getByRole("button", { name: "Save transfer" }));
  expect(
    await screen.findByText("Choose a category for the fee."),
  ).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("keeps More closed when there is no fee and refuses mistakes with a plain message", async () => {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  view();
  expect(screen.getByText(/^More/).closest("details")).not.toHaveAttribute(
    "open",
  );
  await userEvent.type(screen.getByLabelText("Amount (USD)"), "100");
  const fee = screen.getByLabelText("Fee (optional)");
  for (const [typed, message] of [
    ["abc", /amount like 2 or 1\.50, or a percentage like 2%/],
    ["101%", /between 0\.01% and 100%/],
    ["0", /amount like 2 or 1\.50/],
  ] as const) {
    await userEvent.clear(fee);
    await userEvent.type(fee, typed);
    await userEvent.click(
      screen.getByRole("button", { name: "Save transfer" }),
    );
    expect(await screen.findByText(message)).toBeInTheDocument();
  }
  await userEvent.clear(fee);
  await userEvent.type(fee, "0.01%");
  await userEvent.clear(screen.getByLabelText("Amount (USD)"));
  await userEvent.type(screen.getByLabelText("Amount (USD)"), "1");
  await userEvent.click(screen.getByRole("button", { name: "Save transfer" }));
  expect(
    await screen.findByText("That fee comes to less than the smallest unit."),
  ).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("moves the bonus category under More too", async () => {
  view({
    accounts: [
      bank,
      { ...cash, inboundBonusBps: 250, bonusCategoryId: salary.id },
    ],
  });
  const more = screen.getByText(/^More/).closest("details");
  expect(more).not.toHaveAttribute("open");
  expect(more).toContainElement(screen.getByLabelText("Bonus category"));
  expect(more).toContainElement(screen.getByLabelText("Fee category"));
  await userEvent.click(screen.getByText(/^More/));
  expect(more).toHaveAttribute("open");
});

it("offers to delete the fee with its transfer", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  const fee = {
    transactionId: newId(),
    amount: { amount: 200, currency: "USD" },
    categoryId: fees.id,
    deletedAt: null,
  };
  view({ transfer: saved({ fee }) });
  expect(screen.getByText(/This transfer has a fee entry/)).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Delete transfer" }),
  );
  const box = screen.getByLabelText("Also delete its fee entry");
  expect(box).toBeChecked();
  await userEvent.click(box);
  await userEvent.click(box);
  await userEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
  await waitFor(() => expect(props.onDeleted).toHaveBeenCalled());
  expect(requestBody(fetchMock)).toMatchObject({ deleteFee: true });
});
