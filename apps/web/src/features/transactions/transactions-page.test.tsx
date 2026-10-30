import type { Transaction } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivacyContext } from "../../lib/preferences";
import { getCategories } from "../categories/api";
import { getTags } from "../tags/api";
import { getAllAccounts, getTransactions } from "./api";
import { TransactionsPage } from "./transactions-page";

const router = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
  navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  useSearch: () => router.search,
  useNavigate: () => router.navigate,
  Link: ({
    children,
    to,
    className,
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
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
vi.mock("./workspace", () => ({
  useTransactionWorkspace: () => workspace.current,
}));
vi.mock("../../lib/api", async (original) => ({
  ...(await original<typeof import("../../lib/api")>()),
  getLedgers: vi.fn(async () => ({
    items: [
      {
        id: "l1",
        name: "Personal",
        baseCurrency: "USD",
        timeZone: null,
        version: 1,
        role: "owner",
      },
    ],
  })),
}));
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  getTransactions: vi.fn(),
  getAllAccounts: vi.fn(),
}));
vi.mock("../categories/api", () => ({ getCategories: vi.fn() }));
vi.mock("../tags/api", () => ({ getTags: vi.fn() }));
vi.mock("../exports/export-button", () => ({
  ExportButton: ({
    filters,
    disabled,
  }: {
    filters: Record<string, unknown>;
    disabled: boolean;
  }) => (
    <button
      type="button"
      disabled={disabled}
      data-filters={JSON.stringify(filters)}
    >
      Export CSV
    </button>
  ),
}));

let counter = 0;
type Over = Omit<Partial<Transaction>, "amount"> & {
  amount?: number;
  currency?: string;
};
function entry(over: Over = {}): Transaction {
  counter++;
  const currency = over.currency ?? "USD";
  const { amount, currency: _c, ...rest } = over;
  return {
    id: `t${counter}`,
    ledgerId: "l1",
    accountId: "a1",
    categoryId: "c1",
    kind: "expense",
    date: "2026-10-05",
    time: null,
    amount: { amount: amount ?? -765, currency },
    status: "cleared",
    payee: null,
    note: null,
    fxRate: "1",
    baseAmount: { amount: amount ?? -765, currency: "USD" },
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
    ...rest,
  } as Transaction;
}
const accounts = [
  { id: "a1", name: "Checking", archivedAt: null },
  { id: "a2", name: "Cash", archivedAt: null },
  { id: "a3", name: "Old account", archivedAt: "2026-01-01T00:00:00.000Z" },
];
const categories = [
  { id: "c1", name: "Food", parentId: null, archivedAt: null },
  { id: "c2", name: "Groceries", parentId: "c1", archivedAt: null },
  { id: "c3", name: "Pay", parentId: null, archivedAt: null },
];
const tags = [
  { id: "g1", name: "Holiday", archivedAt: null },
  { id: "g2", name: "Old trip", archivedAt: "2026-01-01T00:00:00.000Z" },
];
const tag = (name: string) => ({ id: `tag-${name}`, name, archived: false });

let client: QueryClient;
function pages(...lists: Transaction[][]) {
  const mock = vi.mocked(getTransactions);
  for (const [index, items] of lists.entries())
    mock.mockResolvedValueOnce({
      items,
      nextCursor: index < lists.length - 1 ? `cursor-${index}` : null,
    } as never);
}
function mount(search: Record<string, unknown> = {}, { privacy = false } = {}) {
  router.search = search;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // A new element each time, so a rerender really renders (React skips an element it has seen).
  const tree = () => (
    <QueryClientProvider client={client}>
      <PrivacyContext value={privacy}>
        <TransactionsPage />
      </PrivacyContext>
    </QueryClientProvider>
  );
  const view = render(tree());
  return {
    view,
    rerender: (next: Record<string, unknown>) => {
      router.search = next;
      view.rerender(tree());
    },
  };
}
beforeEach(() => {
  router.navigate.mockReset();
  router.search = {};
  workspace.current = null;
  vi.mocked(getTransactions).mockReset();
  vi.mocked(getAllAccounts).mockResolvedValue(accounts as never);
  vi.mocked(getCategories).mockResolvedValue(categories as never);
  vi.mocked(getTags).mockResolvedValue(tags as never);
});
afterEach(() => {
  cleanup();
  client?.clear();
});
const rowOf = (name: RegExp | string) => screen.findByRole("button", { name });

describe("the page", () => {
  it("has the heading, a search and a Filters button, and none of the old chrome", async () => {
    pages([entry({ payee: "Corner Cafe" })]);
    mount();
    expect(
      screen.getByRole("heading", { level: 1, name: "Transactions" }),
    ).toHaveAttribute("id", "transactions-title");
    expect(
      screen.getByLabelText("Search payer, payee or note"),
    ).toHaveAttribute("placeholder", "Search transactions");
    expect(
      screen.getByRole("button", { name: /^Filters/ }),
    ).toBeInTheDocument();
    await rowOf(/Corner Cafe/);
    expect(screen.queryByText("YOUR LEDGER")).toBeNull();
    expect(screen.queryByText(/Find an entry, check its details/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply filters" })).toBeNull();
    expect(screen.queryByText("Filter entries")).toBeNull();
    expect(screen.queryByText("Import and export")).toBeNull();
    expect(document.querySelector("details")).toBeNull();
  });

  it("passes the applied filters to Export CSV and turns it off for an invalid range", async () => {
    pages([entry()]);
    mount({ accountId: "a1", text: "x" });
    const button = await screen.findByRole("button", { name: "Export CSV" });
    expect(JSON.parse(button.getAttribute("data-filters") ?? "{}")).toEqual({
      accountId: "a1",
      text: "x",
    });
    expect(button).toBeEnabled();
    cleanup();
    mount({ from: "2026-10-10", to: "2026-10-01" });
    expect(
      await screen.findByRole("button", { name: "Export CSV" }),
    ).toBeDisabled();
  });

  it("shows loading, then the rows", async () => {
    pages([entry({ payee: "Corner Cafe" })]);
    mount();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading transactions",
    );
    await rowOf(/Corner Cafe/);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("explains an empty list differently with and without filters", async () => {
    pages([]);
    mount();
    expect(
      await screen.findByRole("heading", { name: "No matching entries" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Use Add to record your first income or expense."),
    ).toBeInTheDocument();
    cleanup();
    pages([]);
    mount({ text: "zzz" });
    expect(
      await screen.findByText("Try another search or clear the filters."),
    ).toBeInTheDocument();
  });

  it("says it could not load, and tries again", async () => {
    vi.mocked(getTransactions).mockRejectedValueOnce(new Error("boom"));
    pages([entry({ payee: "Corner Cafe" })]);
    mount();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load all transaction details.");
    await userEvent.click(
      within(alert.parentElement as HTMLElement).getByRole("button", {
        name: "Try again",
      }),
    );
    await rowOf(/Corner Cafe/);
  });

  it("shows no list and an alert for a range that ends before it starts, and does not ask for entries", async () => {
    mount({ from: "2026-10-10", to: "2026-10-01" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose an end date on or after the start date.",
    );
    expect(getTransactions).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("heading", { name: "No matching entries" }),
    ).toBeNull();
  });

  it("loads more, and does not show a row twice", async () => {
    const first = entry({ payee: "First" });
    pages([first], [first, entry({ payee: "Second" })]);
    mount();
    await rowOf(/First/);
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await rowOf(/Second/);
    expect(screen.getAllByRole("button", { name: /First/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("stops and says so when the server keeps sending the same page", async () => {
    vi.mocked(getTransactions).mockResolvedValue({
      items: [entry({ payee: "Loop" })],
      nextCursor: "same",
    } as never);
    mount();
    await rowOf(/Loop/);
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(
      await screen.findByText(
        "Pagination stopped advancing. Refresh the list before continuing.",
      ),
    ).toBeInTheDocument();
  });
});

describe("rows", () => {
  it("shows a title, one hint with the category and the account, and the amount", async () => {
    pages([entry({ payee: "Corner Cafe", amount: -765 })]);
    mount();
    const row = await rowOf("Open transaction: Corner Cafe");
    expect(row).toHaveAttribute("id", expect.stringMatching(/^transaction-/));
    expect(within(row).getByText("Corner Cafe")).toBeInTheDocument();
    expect(row).toHaveTextContent("Food");
    expect(row).toHaveTextContent("Checking");
    expect(within(row).getByText("-$7.65")).toBeInTheDocument();
  });

  it("does not repeat the category when it is already the title", async () => {
    pages([entry({ payee: null }), entry({ payee: "Corner Cafe" })]);
    mount();
    const bare = await rowOf("Open transaction: Food");
    expect(within(bare).getAllByText(/Food/)).toHaveLength(1);
    // The account still follows, without a stray separator.
    expect(bare.querySelector(".tx-inline-account")?.textContent).toBe(
      "Checking",
    );
    const named = await rowOf("Open transaction: Corner Cafe");
    expect(within(named).getByText(/Food/)).toBeInTheDocument();
    expect(named.querySelector(".tx-inline-account")?.textContent).toBe(
      " · Checking",
    );
  });

  it("names a split, an unavailable category and an archived account", async () => {
    pages([
      entry({ isSplit: true, splits: [{}, {}] as never, categoryId: null }),
      entry({ categoryId: "gone", accountId: "a3" }),
    ]);
    mount();
    expect(
      await rowOf("Open transaction: Split transaction"),
    ).toHaveTextContent("Split · 2 categories");
    const lost = await rowOf("Open transaction: Category unavailable");
    expect(lost).toHaveTextContent("Old account (archived)");
  });

  it("adds the time, a service payment, a fee and a tip to the hint", async () => {
    pages([
      entry({
        payee: "A",
        time: "09:05",
        receivablePaymentId: "r1",
        feeTransferId: "f1",
        tipPaymentId: "p1",
      }),
    ]);
    mount();
    const row = await rowOf(/Open transaction: A/);
    expect(row).toHaveTextContent("9:05 AM");
    expect(row).toHaveTextContent("Service payment");
    expect(row).toHaveTextContent("Transfer fee");
    expect(row).toHaveTextContent("Tip");
  });

  it("shows income with a plus sign, a pending entry with a Pending marker, and a note and tags", async () => {
    pages([
      entry({ payee: "Acme", amount: 125000, kind: "income" }),
      entry({
        payee: "Waiting",
        status: "pending",
        note: "check it",
        tags: [tag("Holiday")],
      }),
    ]);
    mount();
    const income = await rowOf("Open transaction: Acme");
    expect(within(income).getByText("+$1,250.00")).toBeInTheDocument();
    expect(within(income).queryByText("Pending")).toBeNull();
    const pending = await rowOf("Open transaction: Waiting");
    expect(within(pending).getByText("Pending")).toBeInTheDocument();
    expect(within(pending).getByText("check it")).toBeInTheDocument();
    expect(within(pending).getByText("Holiday")).toHaveClass("tag-chip");
  });

  it("shows a foreign entry in its own currency with the base value", async () => {
    pages([entry({ payee: "Paris", amount: -1250, currency: "EUR" })]);
    mount();
    const row = await rowOf("Open transaction: Paris");
    expect(within(row).getByText("-€12.50")).toBeInTheDocument();
    expect(row).toHaveTextContent("About -$12.50");
  });

  it("opens the entry in place, and is off while the workspace is blocked or the accounts are still loading", async () => {
    const openTransaction = vi.fn();
    workspace.current = { blocked: false, openTransaction };
    const first = entry({ payee: "Corner Cafe" });
    pages([first]);
    mount();
    await userEvent.click(await rowOf(/Corner Cafe/));
    expect(openTransaction).toHaveBeenCalledWith(first);
    cleanup();
    workspace.current = { blocked: true, openTransaction };
    pages([entry({ payee: "Corner Cafe" })]);
    mount();
    expect(await rowOf(/Corner Cafe/)).toBeDisabled();
  });

  it("hides every amount in privacy mode", async () => {
    pages([entry({ payee: "Corner Cafe", amount: -765 })]);
    const { view } = mount({}, { privacy: true });
    await rowOf(/Corner Cafe/);
    expect(view.container.textContent).not.toMatch(/\$\s?\d/);
    expect(screen.getAllByText("Amount hidden").length).toBeGreaterThan(0);
    expect(view.container.textContent).not.toContain("+");
  });
});

describe("a transfer", () => {
  const out = () =>
    entry({
      kind: "transfer",
      transferId: "t-1",
      categoryId: null,
      amount: -5000,
      accountId: "a1",
    });
  const into = () =>
    entry({
      kind: "transfer",
      transferId: "t-1",
      categoryId: null,
      amount: 5000,
      accountId: "a2",
    });

  it("is one row from one account to the other, with no sign", async () => {
    pages([into(), out()]);
    mount();
    const row = await rowOf("Open transaction: Transfer from Checking to Cash");
    expect(within(row).getByText("Checking → Cash")).toBeInTheDocument();
    expect(within(row).getByText("$50.00")).toBeInTheDocument();
    expect(row).toHaveTextContent("Transfer");
    expect(
      screen.getAllByRole("button", { name: /^Open transaction/ }),
    ).toHaveLength(1);
  });

  it("opens from the leg that left", async () => {
    const openTransaction = vi.fn();
    workspace.current = { blocked: false, openTransaction };
    const leaving = out();
    pages([into(), leaving]);
    mount();
    await userEvent.click(await rowOf(/Transfer from Checking to Cash/));
    expect(openTransaction).toHaveBeenCalledWith(leaving);
  });

  it("stays a row of its own while the other leg is not loaded", async () => {
    pages([out()]);
    mount({ accountId: "a1" });
    expect(
      await rowOf("Open transaction: Transfer from Checking"),
    ).toHaveTextContent("Transfer");
  });

  it("shows a lone incoming leg with no plus sign or income colour", async () => {
    pages([into()]);
    mount({ accountId: "a2" });
    const row = await rowOf("Open transaction: Transfer to Cash");
    expect(within(row).getByText("$50.00")).toBeInTheDocument();
    expect(row).not.toHaveTextContent("+");
    expect(within(row).getByText("$50.00").parentElement).not.toHaveClass(
      "tx-pos",
    );
  });

  it("is two rows when the amounts differ", async () => {
    pages([
      entry({
        kind: "transfer",
        transferId: "t-2",
        categoryId: null,
        amount: -5000,
      }),
      entry({
        kind: "transfer",
        transferId: "t-2",
        categoryId: null,
        amount: 4600,
        accountId: "a2",
        currency: "EUR",
      }),
    ]);
    mount();
    await rowOf("Open transaction: Transfer from Checking");
    expect(
      screen.getAllByRole("button", { name: /^Open transaction/ }),
    ).toHaveLength(2);
  });
});

describe("days", () => {
  it("has a heading per day with the day's net, a plus sign when it came out ahead", async () => {
    pages([
      entry({
        date: "2026-10-06",
        payee: "Pay",
        amount: 10000,
        kind: "income",
      }),
      entry({ date: "2026-10-06", payee: "Lunch", amount: -2500 }),
      entry({ date: "2026-10-05", payee: "Dinner", amount: -4000 }),
    ]);
    mount();
    await rowOf(/Lunch/);
    const days = screen.getAllByRole("heading", { level: 2 });
    expect(days.map((d) => d.textContent)).toEqual([
      "Tue, Oct 6, 2026",
      "Mon, Oct 5, 2026",
    ]);
    const first = screen.getByRole("region", { name: "Tue, Oct 6, 2026" });
    expect(within(first).getByText("+$75.00")).toBeInTheDocument();
    const second = screen.getByRole("region", { name: "Mon, Oct 5, 2026" });
    // The day's net and the one row it adds up.
    expect(within(second).getAllByText("-$40.00")).toHaveLength(2);
  });

  it("waits to show the oldest day's net while more entries may come", async () => {
    pages(
      [
        entry({ date: "2026-10-06", amount: -100 }),
        entry({ date: "2026-10-05", amount: -200, payee: "Old" }),
      ],
      [entry({ date: "2026-10-05", amount: -300 })],
    );
    const { view } = mount();
    await rowOf(/Old/);
    // Only the first day has a net: the oldest may still be partial.
    expect(view.container.querySelectorAll(".tx-net")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("-$3.00");
    expect(view.container.querySelectorAll(".tx-net")).toHaveLength(2);
    expect(
      within(
        screen.getByRole("region", { name: "Mon, Oct 5, 2026" }),
      ).getAllByText("-$5.00"),
    ).toHaveLength(1);
  });
});

describe("kind chips", () => {
  it("show which kind is applied, and All when none is", async () => {
    pages([entry()]);
    mount({ kind: "income" });
    await screen.findByRole("button", { name: /Open transaction/ });
    const group = screen.getByRole("group", { name: "Entry type" });
    expect(
      within(group).getByRole("button", { name: "Income" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("apply at once and keep the other filters", async () => {
    pages([entry()]);
    mount({ text: "x", accountId: "a1" });
    await userEvent.click(
      await screen.findByRole("button", { name: "Expenses" }),
    );
    expect(router.navigate).toHaveBeenCalledWith({
      to: "/transactions",
      search: { text: "x", accountId: "a1", kind: "expense" },
    });
  });

  it("All removes the kind and keeps the rest", async () => {
    pages([entry()]);
    mount({ kind: "transfer", tagId: "g1" });
    await userEvent.click(await screen.findByRole("button", { name: "All" }));
    expect(router.navigate).toHaveBeenCalledWith({
      to: "/transactions",
      search: { tagId: "g1" },
    });
  });
});

describe("search", () => {
  it("applies after a pause and keeps the other filters", async () => {
    pages([entry()]);
    mount({ kind: "expense" });
    const box = await screen.findByLabelText("Search payer, payee or note");
    fireEvent.change(box, { target: { value: "coffee" } });
    expect(router.navigate).not.toHaveBeenCalled();
    await waitFor(() => expect(router.navigate).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
    expect(router.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        search: { kind: "expense", text: "coffee" },
        replace: true,
      }),
    );
  });

  it("applies at once on Enter", async () => {
    pages([entry()]);
    mount();
    const box = await screen.findByLabelText("Search payer, payee or note");
    fireEvent.change(box, { target: { value: "tea" } });
    fireEvent.submit(box.closest("form") as HTMLFormElement);
    expect(router.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ search: { text: "tea" } }),
    );
  });

  it("does not navigate for a search that is already applied", async () => {
    pages([entry()]);
    mount({ text: "tea" });
    const box = await screen.findByLabelText("Search payer, payee or note");
    expect(box).toHaveValue("tea");
    fireEvent.submit(box.closest("form") as HTMLFormElement);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("keeps what is typed when its own earlier change comes back in the address", async () => {
    pages([entry()], [entry()]);
    const { rerender } = mount();
    const box = await screen.findByLabelText("Search payer, payee or note");
    fireEvent.change(box, { target: { value: "a" } });
    await waitFor(() => expect(router.navigate).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
    fireEvent.change(box, { target: { value: "ab" } });
    rerender({ text: "a" });
    expect(box).toHaveValue("ab");
  });

  it("follows the address when the filters are cleared elsewhere", async () => {
    pages([entry()], [entry()]);
    const { rerender } = mount({ text: "tea" });
    const box = await screen.findByLabelText("Search payer, payee or note");
    expect(box).toHaveValue("tea");
    rerender({});
    await waitFor(() => expect(box).toHaveValue(""));
  });
});

describe("Clear filters", () => {
  it("is there only when something is applied, and clears everything", async () => {
    pages([entry()]);
    mount();
    await screen.findByRole("button", { name: /Open transaction/ });
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    cleanup();
    pages([entry()]);
    mount({ text: "x", kind: "income", status: "pending" });
    await userEvent.click(
      await screen.findByRole("button", { name: "Clear filters" }),
    );
    expect(router.navigate).toHaveBeenCalledWith({
      to: "/transactions",
      search: {},
    });
  });
});

describe("the Filters sheet", () => {
  async function open(search: Record<string, unknown> = {}) {
    pages([entry()]);
    mount(search);
    await screen.findByRole("button", { name: /Open transaction/ });
    await userEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    return screen.findByRole("dialog", { name: "Filters" });
  }

  it("shows how many of its filters are set on the button", async () => {
    pages([entry()]);
    mount({ accountId: "a1", status: "pending", text: "x", kind: "income" });
    expect(
      await screen.findByRole("button", { name: /^Filters.*2/ }),
    ).toBeInTheDocument();
    cleanup();
    pages([entry()]);
    mount({});
    expect(
      await screen.findByRole("button", { name: "Filters" }),
    ).toBeInTheDocument();
  });

  it("starts from the applied filters", async () => {
    const dialog = await open({
      accountId: "a2",
      categoryId: "c3",
      tagId: "g1",
      from: "2026-10-01",
      to: "2026-10-31",
      status: "cleared",
    });
    expect(
      within(dialog).getByLabelText("Account", { exact: true }),
    ).toHaveValue("a2");
    expect(
      within(dialog).getByLabelText("Category", { exact: true }),
    ).toHaveValue("c3");
    expect(within(dialog).getByLabelText("Tag", { exact: true })).toHaveValue(
      "g1",
    );
    expect(
      within(dialog).getByLabelText("From date", { exact: true }),
    ).toHaveValue("2026-10-01");
    expect(
      within(dialog).getByLabelText("To date", { exact: true }),
    ).toHaveValue("2026-10-31");
    expect(
      within(dialog).getByRole("radio", { name: "Cleared" }),
    ).toBeChecked();
  });

  it("lists every account, category and tag with archived ones marked", async () => {
    const dialog = await open();
    const account = within(dialog).getByLabelText("Account", { exact: true });
    expect(
      within(account).getByRole("option", { name: "All accounts" }),
    ).toBeInTheDocument();
    expect(
      within(account).getByRole("option", { name: "Old account (archived)" }),
    ).toBeInTheDocument();
    const category = within(dialog).getByLabelText("Category", { exact: true });
    expect(
      within(category).getByRole("option", { name: "Food / Groceries" }),
    ).toBeInTheDocument();
    const tagBox = within(dialog).getByLabelText("Tag", { exact: true });
    expect(
      within(tagBox).getByRole("option", { name: "Old trip (archived)" }),
    ).toBeInTheDocument();
  });

  it("keeps the draft until Apply: Cancel changes nothing", async () => {
    const dialog = await open();
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Account", { exact: true }),
      "a2",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );
    expect(router.navigate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Reopened, it starts from what is applied, not from the dropped draft.
    await userEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    expect(
      within(await screen.findByRole("dialog")).getByLabelText("Account", {
        exact: true,
      }),
    ).toHaveValue("");
  });

  it("applies the draft over the search and the kind, and closes", async () => {
    const dialog = await open({ text: "x", kind: "income" });
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Account", { exact: true }),
      "a2",
    );
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Category", { exact: true }),
      "c1",
    );
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Pending" }),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Apply" }),
    );
    expect(router.navigate).toHaveBeenCalledWith({
      to: "/transactions",
      search: {
        text: "x",
        kind: "income",
        accountId: "a2",
        categoryId: "c1",
        includeSubcategories: true,
        status: "pending",
      },
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Reset all empties the draft but applies nothing until Apply", async () => {
    const dialog = await open({ accountId: "a2", status: "pending" });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Reset all" }),
    );
    expect(router.navigate).not.toHaveBeenCalled();
    expect(
      within(dialog).getByLabelText("Account", { exact: true }),
    ).toHaveValue("");
    expect(within(dialog).getByRole("radio", { name: "All" })).toBeChecked();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Apply" }),
    );
    expect(router.navigate).toHaveBeenCalledWith({
      to: "/transactions",
      search: {},
    });
  });

  it("says a category includes its subcategories, only for one that has them", async () => {
    const dialog = await open();
    const category = within(dialog).getByLabelText("Category", { exact: true });
    await userEvent.selectOptions(category, "c1");
    expect(
      within(dialog).getByText("Includes its subcategories."),
    ).toBeInTheDocument();
    await userEvent.selectOptions(category, "c3");
    expect(
      within(dialog).queryByText("Includes its subcategories."),
    ).toBeNull();
  });

  it("refuses an end date before the start: it says so and cannot apply", async () => {
    const dialog = await open();
    fireEvent.change(
      within(dialog).getByLabelText("From date", { exact: true }),
      { target: { value: "2026-10-10" } },
    );
    fireEvent.change(
      within(dialog).getByLabelText("To date", { exact: true }),
      { target: { value: "2026-10-01" } },
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Choose an end date on or after the start date.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Apply" }),
    ).toBeDisabled();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Apply" }),
    );
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("accepts the same day as both ends of a range", async () => {
    const dialog = await open();
    fireEvent.change(
      within(dialog).getByLabelText("From date", { exact: true }),
      { target: { value: "2026-10-10" } },
    );
    fireEvent.change(
      within(dialog).getByLabelText("To date", { exact: true }),
      { target: { value: "2026-10-10" } },
    );
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Apply" })).toBeEnabled();
  });

  it("sends no status once All is chosen again", async () => {
    const dialog = await open({ status: "pending" });
    expect(
      within(dialog).getByRole("radio", { name: "Pending" }),
    ).toBeChecked();
    await userEvent.click(within(dialog).getByRole("radio", { name: "All" }));
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Apply" }),
    );
    expect(router.navigate).toHaveBeenCalledWith({
      to: "/transactions",
      search: {},
    });
  });

  it("closes on Escape without applying", async () => {
    await open();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("gives focus back to the Filters button", async () => {
    await open();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Filters/ })).toHaveFocus(),
    );
  });
});
