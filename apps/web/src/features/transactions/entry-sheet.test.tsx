import { type Account, newId, type Transaction } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render as renderPlain,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  category,
  chooseCategory,
  json,
  ledgerId,
} from "../../test-support/category-fixtures";
import { TransactionEditor } from "./editor";
import { QuickAdd } from "./quick-add";
import { QuickAddForm } from "./quick-add-form";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

const actorId = newId();
const food = category("Food");
const salary = category("Salary", { kind: "income" });
const account = (name: string): Account => ({
  id: newId(),
  ledgerId,
  name,
  type: "bank",
  currency: "USD",
  openingBalance: { amount: 0, currency: "USD" },
  inboundBonusBps: null,
  bonusCategoryId: null,
  feeCategoryId: null,
  defaultFee: null,
  contactId: null,
  balance: { amount: 0, currency: "USD" },
  archivedAt: null,
  version: 1,
  createdAt: "2026-10-07T00:00:00.000Z",
  updatedAt: "2026-10-07T00:00:00.000Z",
});
const bank = account("Bank");
const cash = account("Cash");
const row: Transaction = {
  id: newId(),
  ledgerId,
  accountId: bank.id,
  categoryId: food.id,
  kind: "expense",
  date: "2026-10-07",
  time: null,
  amount: { amount: -4215, currency: "USD" },
  baseAmount: { amount: -4215, currency: "USD" },
  fxRate: "1",
  transferId: null,
  relatedTransferId: null,
  feeTransferId: null,
  tipPaymentId: null,
  receivablePaymentId: null,
  receivableId: null,
  isSplit: false,
  splits: [],
  tags: [],
  payee: null,
  note: null,
  status: "cleared",
  version: 1,
  createdAt: bank.createdAt,
  updatedAt: bank.updatedAt,
};
const addProps = {
  actorId,
  ledgerId,
  accounts: [bank, cash],
  categories: [food, salary],
  writable: true,
  blocked: false,
  onDismiss: vi.fn(),
  onSaved: vi.fn(),
  onCategorySaved: vi.fn(),
  onRefresh: vi.fn(async () => {}),
};
const editProps = {
  ledgerId,
  transaction: row,
  accounts: [bank, cash],
  categories: [food, salary],
  writable: true,
  open: true,
  onDismiss: vi.fn(),
  onSaved: vi.fn(),
  onDeleted: vi.fn(),
  onLock: vi.fn(),
};
const render = (ui: React.ReactElement) =>
  renderPlain(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        {children}
      </QueryClientProvider>
    ),
  });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
});
const typeNames = () =>
  within(screen.getByRole("radiogroup", { name: "Entry type" }))
    .getAllByRole("radio")
    .map((radio) => radio.textContent);

it("adds with a type pill instead of the add-mode and entry-type radios", () => {
  render(<QuickAddForm {...addProps} open />);
  expect(typeNames()).toEqual(["Expense", "Income", "Transfer"]);
  expect(screen.getByRole("radio", { name: "Expense" })).toBeChecked();
  expect(screen.queryByText("Add mode")).not.toBeInTheDocument();
});

it("shows time, payee, note, tags and Pending at once, with no More details to open", () => {
  render(<QuickAddForm {...addProps} open />);
  expect(screen.queryByText("More details")).not.toBeInTheDocument();
  for (const label of ["Time (optional)", "Payee", "Note", "Tags"])
    expect(screen.getByLabelText(label)).toBeVisible();
  expect(screen.getByRole("switch", { name: "Pending" })).not.toBeChecked();
  expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
});

it("says what the payee is called once the type is income", async () => {
  render(<QuickAddForm {...addProps} open />);
  await userEvent.click(screen.getByRole("radio", { name: "Income" }));
  expect(screen.getByLabelText("Payer")).toBeInTheDocument();
});

it("shows the currency code beside the amount", () => {
  render(<QuickAddForm {...addProps} open />);
  expect(screen.getByLabelText("Amount (USD)")).toBeInTheDocument();
  expect(
    screen.getByText("USD", { selector: ".entry-amount-code" }),
  ).toBeInTheDocument();
});

it("pins Save in the sheet's foot and saves a pending entry from the switch", async () => {
  const fetchMock = vi.fn<typeof fetch>(async () => json(row, 201));
  vi.stubGlobal("fetch", fetchMock);
  const saved = vi.fn();
  render(<QuickAddForm {...addProps} open onSaved={saved} />);
  const save = screen.getByRole("button", { name: "Save transaction" });
  expect(save.closest(".ui-sheet-foot")).not.toBeNull();
  await userEvent.type(screen.getByLabelText("Amount (USD)"), "42.15");
  await chooseCategory("Category", food.name);
  await userEvent.click(screen.getByRole("switch", { name: "Pending" }));
  expect(screen.getByRole("switch", { name: "Pending" })).toBeChecked();
  await userEvent.click(save);
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
    status: "pending",
    kind: "expense",
  });
});

it("reports the chosen type so the Add sheet can switch to a transfer", async () => {
  const onType = vi.fn();
  render(<QuickAddForm {...addProps} open onTypeChange={onType} />);
  await userEvent.click(screen.getByRole("radio", { name: "Transfer" }));
  expect(onType).toHaveBeenLastCalledWith("transfer");
});

it("moves between an entry and a transfer in the Add sheet without losing the pill", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (path) =>
      String(path).includes("/accounts?")
        ? json({ items: [bank, cash], nextCursor: null })
        : json({ items: [food, salary], nextCursor: null }),
    ),
  );
  render(
    <QuickAdd
      actorId={actorId}
      ledgerId={ledgerId}
      open
      writable
      onDismiss={vi.fn()}
      returnFocusId="add-transaction"
    />,
  );
  await screen.findByLabelText("Amount (USD)");
  await userEvent.click(screen.getByRole("radio", { name: "Transfer" }));
  expect(await screen.findByLabelText("From account")).toBeInTheDocument();
  expect(typeNames()).toEqual(["Expense", "Income", "Transfer"]);
  expect(screen.getByRole("radio", { name: "Transfer" })).toBeChecked();
  await userEvent.click(screen.getByRole("radio", { name: "Income" }));
  expect(await screen.findByLabelText("Payer")).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Income" })).toBeChecked();
});

it("edits with an Expense and Income pill and a Pending switch that follows the entry", () => {
  render(
    <TransactionEditor
      {...editProps}
      transaction={{ ...row, status: "pending" }}
    />,
  );
  expect(typeNames()).toEqual(["Expense", "Income"]);
  expect(screen.getByRole("radio", { name: "Expense" })).toBeChecked();
  expect(screen.getByRole("switch", { name: "Pending" })).toBeChecked();
  expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
  expect(
    screen
      .getByRole("button", { name: "Save changes" })
      .closest(".ui-sheet-foot"),
  ).not.toBeNull();
});

it("keeps the type of a transfer's fee fixed", () => {
  render(
    <TransactionEditor
      {...editProps}
      transaction={{ ...row, feeTransferId: newId() }}
    />,
  );
  for (const radio of screen.getAllByRole("radio"))
    expect(radio).toBeDisabled();
});

it("asks before deleting in a centred question, and Keep entry leaves it be", async () => {
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(null, { status: 204 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<TransactionEditor {...editProps} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Delete transaction" }),
  );
  const question = await screen.findByRole("dialog", {
    name: "Delete this entry?",
  });
  expect(
    within(question).getByText(/You can undo the deletion/),
  ).toBeInTheDocument();
  await userEvent.click(
    within(question).getByRole("button", { name: "Keep entry" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Delete this entry?" }),
    ).not.toBeInTheDocument(),
  );
  expect(fetchMock).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Delete transaction" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Confirm delete" }),
  );
  await waitFor(() => expect(editProps.onDeleted).toHaveBeenCalled());
});

it("closes the delete question when deletion is confirmed", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => new Response(null, { status: 204 })),
  );
  render(<TransactionEditor {...editProps} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Delete transaction" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Confirm delete" }),
  );
  await waitFor(() => expect(editProps.onDeleted).toHaveBeenCalled());
  expect(
    screen.queryByRole("dialog", { name: "Delete this entry?" }),
  ).not.toBeInTheDocument();
});

it("leaves a read-only ledger's type pill and Pending switch alone", () => {
  render(<TransactionEditor {...editProps} writable={false} />);
  for (const radio of screen.getAllByRole("radio"))
    expect(radio).toBeDisabled();
  expect(screen.getByRole("switch", { name: "Pending" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  render(<QuickAddForm {...addProps} open writable={false} />);
  expect(screen.getByRole("radio", { name: "Transfer" })).toBeDisabled();
});

it("does not offer to split a transfer's fee", () => {
  render(
    <TransactionEditor
      {...editProps}
      transaction={{ ...row, feeTransferId: newId() }}
    />,
  );
  expect(screen.queryByLabelText("Split across categories")).toBeNull();
  render(<TransactionEditor {...editProps} />);
  expect(screen.getByLabelText("Split across categories")).toBeInTheDocument();
});

it("keeps the account of an entry whose account is archived, and says so", () => {
  const old = { ...account("Old account"), archivedAt: bank.createdAt };
  render(
    <TransactionEditor
      {...editProps}
      accounts={[bank, cash, old]}
      transaction={{ ...row, accountId: old.id }}
    />,
  );
  const select = screen.getByLabelText("Account");
  expect(select).toHaveValue(old.id);
  expect(
    within(select).getByRole("option", { name: "Old account (archived)" }),
  ).toBeDisabled();
});

it("clears the category when the type changes", async () => {
  render(<QuickAddForm {...addProps} open />);
  await chooseCategory("Category", food.name);
  expect(screen.getByLabelText("Category")).toHaveValue("Food");
  await userEvent.click(screen.getByRole("radio", { name: "Income" }));
  expect(screen.getByLabelText("Category")).toHaveValue("");
});

it("clears the categories of the split lines when the type changes", async () => {
  render(<QuickAddForm {...addProps} open />);
  await userEvent.click(screen.getByLabelText("Split across categories"));
  await chooseCategory("Split 1 category", food.name);
  expect(screen.getByLabelText("Split 1 category")).toHaveValue("Food");
  await userEvent.click(screen.getByRole("radio", { name: "Income" }));
  expect(screen.getByLabelText("Split 1 category")).toHaveValue("");
});

it("leaves the entry as it was when the pill only asks for a transfer", async () => {
  render(<QuickAddForm {...addProps} open />);
  await chooseCategory("Category", food.name);
  await userEvent.click(screen.getByRole("radio", { name: "Transfer" }));
  expect(screen.getByRole("radio", { name: "Expense" })).toBeChecked();
  expect(screen.getByLabelText("Category")).toHaveValue("Food");
});

it("freezes the whole sheet, pill included, until a stale edit is reloaded", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () =>
      json({ title: "Conflict", detail: "Changed", errors: [] }, 409),
    ),
  );
  render(<TransactionEditor {...editProps} />);
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("button", { name: "Reload latest details" });
  expect(screen.getByLabelText("Payee")).toBeDisabled();
  expect(screen.getByRole("switch", { name: "Pending" })).toBeDisabled();
  for (const radio of screen.getAllByRole("radio"))
    expect(radio).toBeDisabled();
});

it("has no New category button: the Category field itself offers to create a missing one", async () => {
  render(<QuickAddForm {...addProps} open />);
  expect(screen.queryByRole("button", { name: "New category" })).toBeNull();
  const box = screen.getByLabelText("Category", { exact: true });
  await userEvent.type(box, "Coffee");
  expect(
    await screen.findByRole("option", {
      name: "Create expense category “Coffee”",
    }),
  ).toBeInTheDocument();
});

it("offers to create an income category once the type is income, and not for a name that exists", async () => {
  render(<QuickAddForm {...addProps} open />);
  await userEvent.click(screen.getByRole("radio", { name: "Income" }));
  const box = screen.getByLabelText("Category", { exact: true });
  await userEvent.type(box, "Gift");
  expect(
    await screen.findByRole("option", {
      name: "Create income category “Gift”",
    }),
  ).toBeInTheDocument();
  await userEvent.clear(box);
  await userEvent.type(box, "salary");
  expect(screen.queryByRole("option", { name: /^Create/ })).toBeNull();
});

it("selects the category it created, so Save sends it", async () => {
  const coffee = category("Coffee");
  const fetchMock = vi.fn<typeof fetch>(async (path, options) =>
    options?.method === "POST" && String(path).includes("/categories")
      ? json(coffee, 201)
      : json(row, 201),
  );
  vi.stubGlobal("fetch", fetchMock);
  const saved = vi.fn();
  // The page keeps the list in its query cache; this stands in for it.
  function Host() {
    const [list, setList] = useState([food, salary]);
    return (
      <QuickAddForm
        {...addProps}
        categories={list}
        open
        onSaved={saved}
        onCategorySaved={(made) => setList((items) => [...items, made])}
      />
    );
  }
  render(<Host />);
  await userEvent.type(screen.getByLabelText("Amount (USD)"), "3.50");
  await userEvent.type(
    screen.getByLabelText("Category", { exact: true }),
    "Coffee",
  );
  await userEvent.click(
    await screen.findByRole("option", {
      name: "Create expense category “Coffee”",
    }),
  );
  expect(screen.getByLabelText("Category", { exact: true })).toHaveValue(
    "Coffee",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Save transaction" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
  expect(body.categoryId).toBe(coffee.id);
});

it("offers the same creation on a split line", async () => {
  render(<QuickAddForm {...addProps} open />);
  await userEvent.click(screen.getByLabelText("Split across categories"));
  await userEvent.type(screen.getByLabelText("Split 1 category"), "Coffee");
  expect(
    await screen.findByRole("option", {
      name: "Create expense category “Coffee”",
    }),
  ).toBeInTheDocument();
});

it("offers to create a category when editing, and the edit saves with it", async () => {
  const coffee = category("Coffee");
  const fetchMock = vi.fn<typeof fetch>(async (_path, options) =>
    options?.method === "POST"
      ? json(coffee, 201)
      : json({ ...row, version: 2, categoryId: coffee.id }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<TransactionEditor {...editProps} />);
  await userEvent.type(
    screen.getByLabelText("Category", { exact: true }),
    "Coffee",
  );
  await userEvent.click(
    await screen.findByRole("option", {
      name: "Create expense category “Coffee”",
    }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(editProps.onSaved).toHaveBeenCalled());
  const patch = fetchMock.mock.calls.find(
    (call) => call[1]?.method === "PATCH",
  );
  expect(JSON.parse(String(patch?.[1]?.body)).categoryId).toBe(coffee.id);
});

it("will not make a different category while an earlier one is unconfirmed", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError("Lost response"));
  vi.stubGlobal("fetch", fetchMock);
  render(<QuickAddForm {...addProps} open />);
  const box = screen.getByLabelText("Category", { exact: true });
  await userEvent.type(box, "Coffee");
  await userEvent.click(
    await screen.findByRole("option", {
      name: "Create expense category “Coffee”",
    }),
  );
  await screen.findByText(/couldn't confirm the category/);
  await userEvent.clear(box);
  await userEvent.type(box, "Tea");
  await userEvent.click(
    await screen.findByRole("option", {
      name: "Create expense category “Tea”",
    }),
  );
  expect(await screen.findByText(/Confirm “Coffee” first/)).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("lets a refused category name be corrected with a new request", async () => {
  const tea = category("Tea");
  const saved = vi.fn();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      json(
        {
          status: 409,
          title: "Conflict",
          type: "about:blank",
          detail: "That name is taken",
          errors: [],
        },
        409,
      ),
    )
    .mockResolvedValue(json(tea, 201));
  vi.stubGlobal("fetch", fetchMock);
  render(<QuickAddForm {...addProps} open onCategorySaved={saved} />);
  const box = screen.getByLabelText("Category", { exact: true });
  await userEvent.type(box, "Coffee");
  await userEvent.click(
    await screen.findByRole("option", {
      name: "Create expense category “Coffee”",
    }),
  );
  expect(await screen.findByText("That name is taken")).toBeInTheDocument();
  // A refusal is final: nothing is waiting, so Save is not held.
  expect(
    screen.getByRole("button", { name: "Save transaction" }),
  ).toBeEnabled();
  await userEvent.clear(box);
  await userEvent.type(box, "Tea");
  await userEvent.click(
    await screen.findByRole("option", {
      name: "Create expense category “Tea”",
    }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledWith(tea));
  const [first, second] = fetchMock.mock.calls.map((call) => call[1]);
  expect(JSON.parse(String(first?.body)).name).toBe("Coffee");
  expect(JSON.parse(String(second?.body)).name).toBe("Tea");
  expect(new Headers(second?.headers).get("Idempotency-Key")).not.toBe(
    new Headers(first?.headers).get("Idempotency-Key"),
  );
});
