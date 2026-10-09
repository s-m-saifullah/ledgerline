import { type Account, newId, type Transaction } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  category,
  chooseCategory,
  json,
  ledgerId,
} from "../categories/fixtures.test-helper";
import { PrivacyContext } from "../shell/preferences";
import { rememberAccount } from "./form";
import { QuickAdd, QuickAddForm } from "./quick-add";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    onClick,
  }: {
    children: ReactNode;
    to: string;
    onClick?: () => void;
  }) => (
    <a href={to} onClick={onClick}>
      {children}
    </a>
  ),
}));

const actorId = newId(),
  expense = category("Food"),
  income = category("Salary", { kind: "income" });
const bank: Account = {
  id: newId(),
  ledgerId,
  name: "Bank",
  type: "bank",
  currency: "USD",
  openingBalance: { amount: 10000, currency: "USD" },
  balance: { amount: 10000, currency: "USD" },
  archivedAt: null,
  version: 1,
  createdAt: "2026-10-07T00:00:00.000Z",
  updatedAt: "2026-10-07T00:00:00.000Z",
};
const archived = {
  ...bank,
  id: newId(),
  name: "Old account",
  archivedAt: bank.createdAt,
};
const transaction: Transaction = {
  id: newId(),
  ledgerId,
  accountId: bank.id,
  categoryId: expense.id,
  kind: "expense",
  date: "2026-10-07",
  time: null,
  amount: { amount: -4215, currency: "USD" },
  baseAmount: { amount: -4215, currency: "USD" },
  fxRate: 1,
  transferId: null,
  receivablePaymentId: null,
  receivableId: null,
  isSplit: false,
  splits: [],
  payee: null,
  note: null,
  status: "cleared",
  version: 1,
  createdAt: bank.createdAt,
  updatedAt: bank.updatedAt,
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});
const props = {
  actorId,
  ledgerId,
  accounts: [bank, archived],
  categories: [expense, income],
  writable: true,
  blocked: false,
  onDismiss: vi.fn(),
  onSaved: vi.fn(),
  onCategorySaved: vi.fn(),
  onRefresh: vi.fn(async () => {}),
};
async function fill() {
  await userEvent.type(screen.getByLabelText("Amount (USD)"), "42.15");
  await chooseCategory("Category", expense.name);
}
it("focuses amount, validates without writing, then saves exact signed expense", async () => {
  const saved = vi.fn(),
    fetchMock = vi.fn<typeof fetch>(async () => json(transaction, 201));
  vi.stubGlobal("fetch", fetchMock);
  render(<QuickAddForm {...props} open onSaved={saved} />);
  expect(screen.getByLabelText("Amount (USD)")).toHaveFocus();
  expect(
    screen.queryByRole("option", { name: "Old account" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "Salary" }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Save transaction" }),
  );
  expect(
    await screen.findByText(/Enter a positive amount/),
  ).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
  await fill();
  await userEvent.click(
    screen.getByRole("button", { name: "Save transaction" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledWith(transaction));
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
    amount: { amount: -4215, currency: "USD" },
    kind: "expense",
    categoryId: expense.id,
    accountId: bank.id,
    status: "cleared",
  });
});
it("keeps the original save key and payload across close/resume and changing choices", async () => {
  const saved = vi.fn(),
    fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Connection lost"))
      .mockResolvedValue(json(transaction, 201));
  vi.stubGlobal("fetch", fetchMock);
  function Host() {
    const [open, setOpen] = useState(true);
    const [items, setItems] = useState([bank]);
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setItems([]);
            setOpen(true);
          }}
        >
          Resume
        </button>
        <QuickAddForm
          {...props}
          accounts={items}
          open={open}
          onDismiss={() => setOpen(false)}
          onSaved={saved}
        />
      </>
    );
  }
  render(<Host />);
  await fill();
  await userEvent.click(
    screen.getByRole("button", { name: "Save transaction" }),
  );
  expect(
    await screen.findByText(/couldn't confirm the save/),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Amount (USD)")).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Close for now" }));
  await userEvent.click(screen.getByRole("button", { name: "Resume" }));
  await userEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const [first, retry] = fetchMock.mock.calls.map((call) => call[1]);
  expect(retry?.body).toBe(first?.body);
  expect(new Headers(retry?.headers).get("Idempotency-Key")).toBe(
    new Headers(first?.headers).get("Idempotency-Key"),
  );
});
it("clears wrong-kind selections and masks amounts in privacy mode", async () => {
  render(
    <PrivacyContext value>
      <QuickAddForm {...props} open />
    </PrivacyContext>,
  );
  expect(screen.getByLabelText("Amount (USD)")).toHaveAttribute(
    "type",
    "password",
  );
  await chooseCategory("Category", expense.name);
  await userEvent.click(screen.getByRole("radio", { name: "Income" }));
  expect(screen.getByLabelText("Category", { exact: true })).toHaveValue("");
  await userEvent.click(screen.getByLabelText("Category", { exact: true }));
  expect(screen.getByRole("option", { name: "Salary" })).toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "Food" }),
  ).not.toBeInTheDocument();
});
it("creates a category inline and replays an uncertain category before another write", async () => {
  const created = category("Coffee"),
    saved = vi.fn();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError("Lost response"))
    .mockResolvedValue(json(created, 201));
  vi.stubGlobal("fetch", fetchMock);
  render(<QuickAddForm {...props} open onCategorySaved={saved} />);
  await userEvent.click(screen.getByRole("button", { name: "New category" }));
  await userEvent.type(screen.getByLabelText("New category name"), "Coffee");
  await userEvent.click(screen.getByRole("button", { name: "Add category" }));
  expect(
    await screen.findByText(/couldn't confirm the category/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Save transaction" }),
  ).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Retry category" }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith(created));
  const [first, retry] = fetchMock.mock.calls.map((call) => call[1]);
  expect(retry?.body).toBe(first?.body);
  expect(new Headers(retry?.headers).get("Idempotency-Key")).toBe(
    new Headers(first?.headers).get("Idempotency-Key"),
  );
});
it("permits correction after a definitive validation/reference error with a new key", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      json(
        {
          status: 409,
          title: "Conflict",
          type: "about:blank",
          detail: "Choose an active category.",
          errors: [],
        },
        409,
      ),
    )
    .mockResolvedValue(json(transaction, 201));
  vi.stubGlobal("fetch", fetchMock);
  const saved = vi.fn();
  render(<QuickAddForm {...props} open onSaved={saved} />);
  await fill();
  await userEvent.click(
    screen.getByRole("button", { name: "Save transaction" }),
  );
  expect(
    await screen.findByText("Choose an active category."),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Amount (USD)")).toBeEnabled();
  await userEvent.click(
    screen.getByRole("button", { name: "Save transaction" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(
    new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("Idempotency-Key"),
  ).not.toBe(
    new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Idempotency-Key"),
  );
});
it("uses the last-used active account and respects viewer/blocking state", () => {
  const cash = { ...bank, id: newId(), name: "Cash" };
  rememberAccount(actorId, ledgerId, cash.id);
  render(
    <QuickAddForm
      {...props}
      accounts={[bank, cash, archived]}
      open
      writable={false}
    />,
  );
  expect(screen.getByLabelText("Account")).toHaveValue(cash.id);
  expect(
    screen.getByRole("button", { name: "Save transaction" }),
  ).toBeDisabled();
  expect(screen.getByLabelText("Amount (USD)")).toBeDisabled();
});
it("retries Undo with its original key/version and freezes new saves until confirmed", async () => {
  let deletes = 0;
  const fetchMock = vi.fn<typeof fetch>(async (path, options) => {
    if (String(path).includes("/accounts?"))
      return json({ items: [bank], nextCursor: null });
    if (String(path).includes("/categories?"))
      return json({ items: [expense, income], nextCursor: null });
    if (options?.method === "DELETE") {
      deletes++;
      if (deletes === 1) throw new TypeError("Lost response");
      return new Response(null, { status: 204 });
    }
    return json(transaction, 201);
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Host() {
    const [open, setOpen] = useState(true);
    return (
      <QueryClientProvider client={client}>
        <button
          id="add-transaction"
          type="button"
          onClick={() => setOpen(true)}
        >
          Add again
        </button>
        <QuickAdd
          actorId={actorId}
          ledgerId={ledgerId}
          open={open}
          writable
          onDismiss={() => setOpen(false)}
          returnFocusId="add-transaction"
        />
      </QueryClientProvider>
    );
  }
  render(<Host />);
  await screen.findByLabelText("Amount (USD)");
  await fill();
  await userEvent.click(
    screen.getByRole("button", { name: "Save transaction" }),
  );
  expect(await screen.findByText("Transaction saved.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(await screen.findByText(/couldn't confirm Undo/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Add again" }));
  expect(
    screen.getByRole("button", { name: "Save transaction" }),
  ).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await userEvent.click(screen.getByRole("button", { name: "Retry Undo" }));
  await waitFor(() =>
    expect(screen.queryByText("Transaction saved.")).not.toBeInTheDocument(),
  );
  const requests = fetchMock.mock.calls.filter(
    (call) => call[1]?.method === "DELETE",
  );
  expect(requests).toHaveLength(2);
  const [first, retry] = requests.map((call) => call[1]);
  expect(retry?.body).toBe(first?.body);
  expect(JSON.parse(String(first?.body))).toEqual({ expectedVersion: 1 });
  expect(new Headers(retry?.headers).get("Idempotency-Key")).toBe(
    new Headers(first?.headers).get("Idempotency-Key"),
  );
  client.clear();
});
