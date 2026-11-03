import {
  type Account,
  type Category,
  newId,
  type RecurringRule,
  type RecurringRun,
} from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type PageAdd, PageAddProvider } from "../shell/page-add";
import { RecurringPage } from "./recurring-page";
import { ledgerToday } from "./schedule";

const ledgerId = newId();
const stamp = "2026-10-10T00:00:00.000Z";
const bank: Account = {
  id: newId(),
  ledgerId,
  name: "Bank",
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
  createdAt: stamp,
  updatedAt: stamp,
};
const rentCategory: Category = {
  id: newId(),
  ledgerId,
  name: "Housing",
  kind: "expense",
  parentId: null,
  icon: null,
  color: null,
  sortOrder: 0,
  archivedAt: null,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
};
function rule(extra: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: newId(),
    ledgerId,
    title: "Rent",
    kind: "expense",
    accountId: bank.id,
    toAccountId: null,
    categoryId: rentCategory.id,
    amount: { amount: -120000, currency: "USD" },
    receivedAmount: null,
    bonus: null,
    fee: null,
    payee: null,
    note: null,
    tagIds: [],
    frequency: "month",
    interval: 1,
    startDate: "2026-11-01",
    endDate: null,
    nextDate: "2026-11-01",
    paused: false,
    pausedReason: null,
    needsAttention: 0,
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
    ...extra,
  };
}
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
});
function mount({
  role = "owner",
  timeZone = "America/Chicago" as string | null,
  rules = [] as RecurringRule[],
  runs = [] as RecurringRun[],
  accounts = [bank] as Account[],
  categories = [rentCategory] as Category[],
  holdAccounts = false,
  wrap = (children: ReactNode): ReactNode => children,
  write = (_url: string, _init: RequestInit) =>
    new Response("{}", { status: 500 }),
} = {}) {
  const writes: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url);
      if (init?.method && init.method !== "GET") {
        writes.push({ url: target, init });
        return write(target, init);
      }
      const json = (body: unknown) => new Response(JSON.stringify(body));
      if (target.includes("/runs")) return json({ items: runs });
      if (target.includes("/recurring-rules")) return json({ items: rules });
      if (target.includes("/accounts")) {
        // A list that never answers: the page is not ready for an editor yet.
        if (holdAccounts) return new Promise<Response>(() => {});
        return json({ items: accounts, nextCursor: null });
      }
      if (target.includes("/categories"))
        return json({ items: categories, nextCursor: null });
      return json({
        items: [
          {
            id: ledgerId,
            name: "Personal",
            baseCurrency: "USD",
            timeZone,
            version: 1,
            role,
          },
        ],
      });
    }),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: RecurringPage,
  });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider client={client}>
      {wrap(<RouterProvider router={router} />)}
    </QueryClientProvider>,
  );
  return writes;
}

const savings: Account = {
  ...bank,
  id: newId(),
  name: "Savings",
  type: "savings",
};
const euro: Account = {
  ...bank,
  id: newId(),
  name: "Euro",
  currency: "EUR",
  openingBalance: { amount: 0, currency: "EUR" },
  balance: { amount: 0, currency: "EUR" },
};
const sheet = () => screen.getByRole("dialog");

describe("RecurringPage", () => {
  it("lists each rule with its schedule, next date, account and flags", async () => {
    mount({
      rules: [
        rule(),
        rule({ title: "Gym", paused: true, pausedReason: "manual" }),
        rule({
          title: "Phone",
          needsAttention: 1,
          interval: 2,
          frequency: "week",
        }),
      ],
    });
    const rent = await screen.findByRole("button", { name: /Rent/ });
    expect(rent.textContent).toContain(
      "Expense · Every month · Next 1 Nov 2026",
    );
    expect(rent.textContent).toContain("Bank");
    const gym = screen.getByRole("button", { name: /Gym/ });
    expect(gym.textContent).toContain("Paused");
    const phone = screen.getByRole("button", { name: /Phone/ });
    expect(phone.textContent).toContain("Every 2 weeks");
    expect(phone.textContent).toContain("1 needs attention");
    expect(phone.textContent).not.toContain("Bank");
  });

  it("asks for the time zone first and offers no add button", async () => {
    mount({ timeZone: null });
    expect(await screen.findByText("Set your time zone first.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add .*rule/ })).toBeNull();
  });

  it("is read-only for viewers", async () => {
    mount({ role: "viewer", rules: [rule()] });
    expect(await screen.findByText(/Next 1 Nov 2026/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector(".ui-row-chevron")).toBeNull();
  });

  it("offers one first rule when there is none", async () => {
    mount();
    expect(await screen.findByText("Nothing recurring yet.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Add .*rule/ })).toHaveLength(
      1,
    );
    expect(
      screen.getByRole("button", { name: "Add your first rule" }),
    ).toBeTruthy();
  });

  it("adds a monthly expense as a negative amount in the account's units", async () => {
    const user = userEvent.setup();
    const saved = rule();
    const writes = mount({
      write: () => new Response(JSON.stringify(saved), { status: 201 }),
    });
    await user.click(
      await screen.findByRole("button", { name: "Add your first rule" }),
    );
    await user.type(await screen.findByLabelText("Name"), "Rent");
    await user.type(screen.getByLabelText(/Amount \(USD\)/), "1,200");
    await user.click(screen.getByRole("combobox", { name: /Category/ }));
    await user.click(await screen.findByRole("option", { name: "Housing" }));
    expect(screen.getByText(/Every month\. Next:/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(writes[0]?.init.body))).toMatchObject({
      title: "Rent",
      kind: "expense",
      accountId: bank.id,
      categoryId: rentCategory.id,
      amount: { amount: -120000, currency: "USD" },
      frequency: "month",
      interval: 1,
      startDate: ledgerToday("America/Chicago"),
      endDate: null,
    });
  });

  it("says what is missing and sends nothing", async () => {
    const user = userEvent.setup();
    const writes = mount();
    await user.click(
      await screen.findByRole("button", { name: "Add your first rule" }),
    );
    await user.click(await screen.findByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Give it a name, such as Rent."),
    ).toBeTruthy();
    expect(screen.getByText("Choose a category.")).toBeTruthy();
    expect(writes).toHaveLength(0);
  });

  it("shows what a rule has done and skips one that needs attention", async () => {
    const user = userEvent.setup();
    const target = rule({ needsAttention: 1 });
    const attention: RecurringRun = {
      id: newId(),
      ruleId: target.id,
      date: "2026-10-01",
      status: "attention",
      reason: "Choose an active account.",
      transactionId: null,
      transferId: null,
      version: 2,
      createdAt: stamp,
      updatedAt: stamp,
    };
    const created: RecurringRun = {
      ...attention,
      id: newId(),
      date: "2026-09-01",
      status: "created",
      reason: null,
      transactionId: newId(),
    };
    const writes = mount({
      rules: [target],
      runs: [attention, created],
      write: () =>
        new Response(
          JSON.stringify({ ...attention, status: "skipped", reason: null }),
        ),
    });
    await user.click(await screen.findByRole("button", { name: /Rent/ }));
    expect(await screen.findByText(/Choose an active account\./)).toBeTruthy();
    expect(screen.getByText("Created")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Skip this one" }));
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.url).toContain(`/recurring-runs/${attention.id}/skip`);
    expect(JSON.parse(String(writes[0]?.init.body))).toEqual({
      expectedVersion: 2,
    });
  });

  it("pauses with the Active switch alone, sending only the pause and the rule's version", async () => {
    const user = userEvent.setup();
    const target = rule({ version: 4 });
    const writes = mount({
      rules: [target],
      write: () => new Response(JSON.stringify({ ...target, paused: true })),
    });
    await user.click(await screen.findByRole("button", { name: /Rent/ }));
    const active = within(sheet()).getByRole("switch", { name: "Active" });
    expect(active).toHaveAttribute("aria-checked", "true");
    await user.click(active);
    expect(writes).toHaveLength(0);
    await user.click(within(sheet()).getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.url).toContain(`/recurring-rules/${target.id}/pause`);
    expect(JSON.parse(String(writes[0]?.init.body))).toEqual({
      expectedVersion: 4,
    });
  });

  it("resumes a paused rule from the switch", async () => {
    const user = userEvent.setup();
    const target = rule({ version: 2, paused: true, pausedReason: "manual" });
    const writes = mount({
      rules: [target],
      write: () => new Response(JSON.stringify({ ...target, paused: false })),
    });
    await user.click(await screen.findByRole("button", { name: /Rent/ }));
    const active = within(sheet()).getByRole("switch", { name: "Active" });
    expect(active).toHaveAttribute("aria-checked", "false");
    await user.click(active);
    await user.click(within(sheet()).getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.url).toContain("/resume");
  });

  it("saves the changed fields first and then pauses on the version that came back", async () => {
    const user = userEvent.setup();
    const target = rule({ version: 4 });
    const writes = mount({
      rules: [target],
      write: (url) =>
        url.endsWith("/pause")
          ? new Response(
              JSON.stringify({ ...target, title: "Rent 2", paused: true }),
            )
          : new Response(
              JSON.stringify({ ...target, title: "Rent 2", version: 5 }),
            ),
    });
    await user.click(await screen.findByRole("button", { name: /Rent/ }));
    const name = within(sheet()).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Rent 2");
    await user.click(within(sheet()).getByRole("switch", { name: "Active" }));
    await user.click(within(sheet()).getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[0]?.init.method).toBe("PATCH");
    expect(JSON.parse(String(writes[0]?.init.body))).toMatchObject({
      title: "Rent 2",
      expectedVersion: 4,
    });
    expect(writes[1]?.url).toContain("/pause");
    expect(JSON.parse(String(writes[1]?.init.body))).toEqual({
      expectedVersion: 5,
    });
  });

  it("sends only an update when the switch did not move", async () => {
    const user = userEvent.setup();
    const target = rule({ version: 4 });
    const writes = mount({
      rules: [target],
      write: () => new Response(JSON.stringify({ ...target, version: 5 })),
    });
    await user.click(await screen.findByRole("button", { name: /Rent/ }));
    await user.type(within(sheet()).getByLabelText(/Note/), "Monthly");
    await user.click(within(sheet()).getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.init.method).toBe("PATCH");
  });

  it("has no Active switch on a new rule", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(
      await screen.findByRole("button", { name: "Add your first rule" }),
    );
    expect(
      within(sheet()).queryByRole("switch", { name: "Active" }),
    ).toBeNull();
    expect(
      within(sheet()).queryByRole("button", { name: "Delete rule" }),
    ).toBeNull();
  });

  it("asks before deleting, and sends the delete only on the question's button", async () => {
    const user = userEvent.setup();
    const target = rule({ version: 4 });
    const writes = mount({
      rules: [target],
      write: () => new Response(null, { status: 204 }),
    });
    await user.click(await screen.findByRole("button", { name: /Rent/ }));
    await user.click(
      await within(sheet()).findByRole("button", { name: "Delete rule" }),
    );
    const question = await screen.findByRole("dialog", {
      name: "Delete Rent?",
    });
    expect(question).toHaveTextContent(
      "Deleting the rule keeps the entries it already made.",
    );
    expect(writes).toHaveLength(0);
    await user.click(within(question).getByRole("button", { name: "Cancel" }));
    expect(writes).toHaveLength(0);
    // The sheet is still there, with its work.
    expect(screen.getByRole("dialog", { name: "Rent" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete rule" }));
    await user.click(
      within(
        await screen.findByRole("dialog", { name: "Delete Rent?" }),
      ).getByRole("button", { name: "Delete" }),
    );
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.init.method).toBe("DELETE");
    expect(JSON.parse(String(writes[0]?.init.body))).toEqual({
      expectedVersion: 4,
    });
  });

  it("shows a failed delete in the sheet, not behind the question", async () => {
    const user = userEvent.setup();
    mount({
      rules: [rule()],
      write: () =>
        new Response(
          JSON.stringify({
            status: 422,
            title: "Nope",
            detail: "Cannot delete.",
          }),
          { status: 422 },
        ),
    });
    await user.click(await screen.findByRole("button", { name: /Rent/ }));
    await user.click(
      await within(sheet()).findByRole("button", { name: "Delete rule" }),
    );
    await user.click(
      within(
        await screen.findByRole("dialog", { name: "Delete Rent?" }),
      ).getByRole("button", { name: "Delete" }),
    );
    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Delete Rent?" })).toBeNull(),
    );
    expect(within(sheet()).getByRole("alert")).toBeTruthy();
  });

  it("shows a transfer's To account, fee and bonus, and takes the expense category away", async () => {
    const user = userEvent.setup();
    mount({ accounts: [bank, savings] });
    await user.click(
      await screen.findByRole("button", { name: "Add your first rule" }),
    );
    expect(within(sheet()).queryByLabelText("To account")).toBeNull();
    expect(within(sheet()).queryByLabelText("Fee (optional)")).toBeNull();
    await user.click(within(sheet()).getByRole("radio", { name: "Transfer" }));
    expect(within(sheet()).getByLabelText("To account")).toBeTruthy();
    expect(within(sheet()).getByLabelText("From account")).toBeTruthy();
    expect(within(sheet()).getByLabelText("Fee (optional)")).toBeTruthy();
    // The bonus is paid into the receiving account, so it waits for one.
    expect(
      within(sheet()).queryByRole("switch", {
        name: "Add a bonus to each transfer",
      }),
    ).toBeNull();
    await user.selectOptions(
      within(sheet()).getByLabelText("To account"),
      savings.id,
    );
    expect(
      within(sheet()).getByRole("switch", {
        name: "Add a bonus to each transfer",
      }),
    ).toBeTruthy();
    expect(
      within(sheet()).queryByRole("combobox", { name: /^Category/ }),
    ).toBeNull();
    expect(within(sheet()).queryByLabelText(/Payee/)).toBeNull();
    expect(within(sheet()).queryByLabelText(/Bonus amount/)).toBeNull();
    await user.click(
      within(sheet()).getByRole("switch", {
        name: "Add a bonus to each transfer",
      }),
    );
    expect(within(sheet()).getByLabelText(/Bonus amount \(USD\)/)).toBeTruthy();
  });

  it("asks for the amount that arrives only between two currencies", async () => {
    const user = userEvent.setup();
    mount({ accounts: [bank, euro] });
    await user.click(
      await screen.findByRole("button", { name: "Add your first rule" }),
    );
    await user.click(within(sheet()).getByRole("radio", { name: "Transfer" }));
    expect(within(sheet()).queryByLabelText(/Amount that arrives/)).toBeNull();
    await user.selectOptions(
      within(sheet()).getByLabelText("To account"),
      euro.id,
    );
    expect(
      within(sheet()).getByLabelText("Amount that arrives (EUR)"),
    ).toBeTruthy();
  });

  it("does not ask for an amount that arrives when both accounts hold the same currency", async () => {
    const user = userEvent.setup();
    mount({ accounts: [bank, savings] });
    await user.click(
      await screen.findByRole("button", { name: "Add your first rule" }),
    );
    await user.click(within(sheet()).getByRole("radio", { name: "Transfer" }));
    await user.selectOptions(
      within(sheet()).getByLabelText("To account"),
      savings.id,
    );
    expect(within(sheet()).queryByLabelText(/Amount that arrives/)).toBeNull();
  });

  it("works out the fee as the person types and opens More for the category it needs", async () => {
    const user = userEvent.setup();
    mount({ accounts: [bank, savings] });
    await user.click(
      await screen.findByRole("button", { name: "Add your first rule" }),
    );
    await user.click(within(sheet()).getByRole("radio", { name: "Transfer" }));
    const more = within(sheet()).getByText("More").closest("details");
    expect(more).not.toHaveAttribute("open");
    await user.type(within(sheet()).getByLabelText(/Amount \(USD\)/), "100");
    await user.type(within(sheet()).getByLabelText("Fee (optional)"), "1.5%");
    expect(sheet().querySelector("#rule-fee-preview")).toHaveTextContent(
      "Fee $1.50 · $101.50 leaves Bank",
    );
    expect(more).toHaveAttribute("open");
  });

  it("opens More when the end date is before the start", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(
      await screen.findByRole("button", { name: "Add your first rule" }),
    );
    const more = within(sheet()).getByText("More").closest("details");
    expect(more).not.toHaveAttribute("open");
    await user.type(within(sheet()).getByLabelText("Name"), "Rent");
    await user.type(within(sheet()).getByLabelText(/Amount \(USD\)/), "10");
    await user.click(
      within(sheet()).getByRole("combobox", { name: /Category/ }),
    );
    await user.click(await screen.findByRole("option", { name: "Housing" }));
    fireEvent.change(within(sheet()).getByLabelText("Ends (optional)"), {
      target: { value: "2000-01-01" },
    });
    await user.click(within(sheet()).getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("The end date cannot be before the start date."),
    ).toBeTruthy();
    expect(more).toHaveAttribute("open");
  });

  it("gives Starts and Ends the picker Add transaction uses, and a picked day lands in the box", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(
      await screen.findByRole("button", { name: "Add your first rule" }),
    );
    expect(
      within(
        screen.getByRole("dialog", { name: "New recurring entry" }),
      ).getByRole("button", { name: "Choose ends" }),
    ).toBeTruthy();
    await user.click(
      within(
        screen.getByRole("dialog", { name: "New recurring entry" }),
      ).getByRole("button", { name: "Choose starts" }),
    );
    const picker = await screen.findByRole("dialog", { name: "Starts" });
    const start = within(
      screen.getByRole("dialog", { name: "New recurring entry" }),
    ).getByLabelText("Starts") as HTMLInputElement;
    const day = picker.querySelector<HTMLButtonElement>(
      `[data-date="${start.value.slice(0, 8)}15"]`,
    );
    expect(day).not.toBeNull();
    await user.click(day as HTMLButtonElement);
    expect(start.value).toBe(`${start.value.slice(0, 8)}15`);
    // The sheet is still there under the picker.
    expect(
      screen.getByRole("dialog", { name: "New recurring entry" }),
    ).toBeTruthy();
  });

  it("takes only digits in Every, however they arrive", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(
      await screen.findByRole("button", { name: "Add your first rule" }),
    );
    const every = within(sheet()).getByLabelText("Every") as HTMLInputElement;
    expect(every.value).toBe("1");
    await user.clear(every);
    await user.type(every, "a1b2c");
    expect(every.value).toBe("12");
    await user.clear(every);
    await user.paste("3 weeks");
    expect(every.value).toBe("3");
    await user.clear(every);
    await user.type(every, "12345");
    // Three digits are the most the limit of 365 can need.
    expect(every.value).toBe("123");
    await user.clear(every);
    await user.type(every, "-2.5e");
    expect(every.value).toBe("25");
    expect(every).toHaveAttribute("inputmode", "numeric");
  });

  it("keeps the rows and every Add button waiting until the accounts and categories are in", async () => {
    const seen: (PageAdd | null)[] = [];
    mount({
      rules: [rule()],
      holdAccounts: true,
      wrap: (children) => (
        <PageAddProvider value={(add) => void seen.push(add)}>
          {children}
        </PageAddProvider>
      ),
    });
    const row = await screen.findByRole("button", { name: /Rent/ });
    expect(row).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add rule" })).toBeDisabled();
    await vi.waitFor(() =>
      expect(seen[seen.length - 1]).toMatchObject({
        label: "Add rule",
        disabled: true,
      }),
    );
  });

  it("opens More for the bonus category as soon as a bonus is on", async () => {
    const user = userEvent.setup();
    mount({ accounts: [bank, savings] });
    await user.click(
      await screen.findByRole("button", { name: "Add your first rule" }),
    );
    await user.click(within(sheet()).getByRole("radio", { name: "Transfer" }));
    await user.selectOptions(
      within(sheet()).getByLabelText("To account"),
      savings.id,
    );
    const more = within(sheet()).getByText("More").closest("details");
    expect(more).not.toHaveAttribute("open");
    await user.click(
      within(sheet()).getByRole("switch", {
        name: "Add a bonus to each transfer",
      }),
    );
    expect(more).toHaveAttribute("open");
    expect(within(sheet()).getByLabelText("Bonus category")).toBeTruthy();
  });

  it("starts a new transfer from the account's usual fee, and never changes an existing rule's fee", async () => {
    const user = userEvent.setup();
    const feeBank: Account = { ...bank, defaultFee: { basisPoints: 200 } };
    const other: Account = { ...savings, defaultFee: { basisPoints: 300 } };
    mount({ accounts: [feeBank, other] });
    await user.click(
      await screen.findByRole("button", { name: "Add your first rule" }),
    );
    await user.click(within(sheet()).getByRole("radio", { name: "Transfer" }));
    expect(within(sheet()).getByLabelText("Fee (optional)")).toHaveValue("2%");
    await user.selectOptions(
      within(sheet()).getByLabelText("From account"),
      other.id,
    );
    expect(within(sheet()).getByLabelText("Fee (optional)")).toHaveValue("3%");
    cleanup();
    const transfer = rule({
      kind: "transfer",
      accountId: feeBank.id,
      toAccountId: other.id,
      categoryId: null,
      amount: { amount: 10000, currency: "USD" },
      fee: { basisPoints: 150, categoryId: rentCategory.id },
    });
    mount({ accounts: [feeBank, other], rules: [transfer] });
    await user.click(await screen.findByRole("button", { name: /Rent/ }));
    expect(within(sheet()).getByLabelText("Fee (optional)")).toHaveValue(
      "1.5%",
    );
    await user.selectOptions(
      within(sheet()).getByLabelText("From account"),
      other.id,
    );
    expect(within(sheet()).getByLabelText("Fee (optional)")).toHaveValue(
      "1.5%",
    );
  });

  it("offers an archived account only to the rule that already uses it", async () => {
    const user = userEvent.setup();
    const old: Account = {
      ...savings,
      name: "Old savings",
      archivedAt: stamp,
    };
    mount({ accounts: [bank, old], rules: [rule({ accountId: old.id })] });
    await user.click(await screen.findByRole("button", { name: /Rent/ }));
    const options = (label: string) =>
      Array.from(
        (within(sheet()).getByLabelText(label) as HTMLSelectElement).options,
        (option) => option.textContent,
      );
    expect(options("Account")).toContain("Old savings (USD)");
    cleanup();
    mount({ accounts: [bank, old] });
    await user.click(
      await screen.findByRole("button", { name: "Add your first rule" }),
    );
    expect(options("Account")).not.toContain("Old savings (USD)");
    expect(options("Account")).toContain("Bank (USD)");
  });

  it("freezes the form while a save is in flight", async () => {
    const user = userEvent.setup();
    let finish: (response: Response) => void = () => {};
    mount({
      rules: [rule({ version: 2 })],
      write: () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }) as unknown as Response,
    });
    await user.click(await screen.findByRole("button", { name: /Rent/ }));
    await user.click(within(sheet()).getByRole("button", { name: "Save" }));
    await vi.waitFor(() =>
      expect(within(sheet()).getByLabelText("Name")).toBeDisabled(),
    );
    expect(
      within(sheet()).getByRole("button", { name: "Saving…" }),
    ).toBeDisabled();
    finish(new Response(JSON.stringify(rule({ version: 3 }))));
  });

  it("freezes the form after a stale save and offers Reload recurring", async () => {
    const user = userEvent.setup();
    mount({
      rules: [rule({ version: 2 })],
      write: () =>
        new Response(
          JSON.stringify({
            type: "about:blank",
            title: "Conflict",
            status: 409,
            detail: "This record changed.",
            errors: [{ field: "expectedVersion", message: "Reload." }],
          }),
          { status: 409 },
        ),
    });
    await user.click(await screen.findByRole("button", { name: /Rent/ }));
    await user.click(within(sheet()).getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText(
        "This rule changed somewhere else. Reload to see the latest.",
      ),
    ).toBeTruthy();
    expect(within(sheet()).getByLabelText("Name")).toBeDisabled();
    expect(within(sheet()).queryByRole("button", { name: "Save" })).toBeNull();
    expect(
      within(sheet()).getByRole("button", { name: "Reload recurring" }),
    ).toBeTruthy();
  });

  it("has no fee or bonus card for a transfer before there is an account to send from", async () => {
    const user = userEvent.setup();
    mount({ accounts: [] });
    await user.click(
      await screen.findByRole("button", { name: "Add your first rule" }),
    );
    const before = sheet().querySelectorAll(".rc-card").length;
    await user.click(within(sheet()).getByRole("radio", { name: "Transfer" }));
    expect(sheet().querySelectorAll(".rc-card").length).toBe(before);
    expect(within(sheet()).queryByLabelText("Fee (optional)")).toBeNull();
  });

  const made = (name: string, kind: Category["kind"]): Category => ({
    ...rentCategory,
    id: newId(),
    name,
    kind,
  });

  it("makes a category from the Category field, as the Add transaction sheet does, and chooses it", async () => {
    const user = userEvent.setup();
    const insurance = made("Insurance", "expense");
    const categories = [rentCategory];
    const writes = mount({
      categories,
      write: (url, init) => {
        if (url.endsWith("/categories") && init.method === "POST") {
          categories.push(insurance);
          return new Response(JSON.stringify(insurance), { status: 201 });
        }
        return new Response(JSON.stringify(rule()), { status: 201 });
      },
    });
    await user.click(
      await screen.findByRole("button", { name: "Add your first rule" }),
    );
    await user.type(within(sheet()).getByLabelText("Name"), "Insurance");
    await user.type(within(sheet()).getByLabelText(/Amount \(USD\)/), "40");
    const box = within(sheet()).getByRole("combobox", { name: /^Category/ });
    await user.type(box, "Insurance");
    await user.click(
      await screen.findByRole("option", {
        name: "Create expense category “Insurance”",
      }),
    );
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.url).toContain("/categories");
    expect(JSON.parse(String(writes[0]?.init.body))).toMatchObject({
      name: "Insurance",
      kind: "expense",
      parentId: null,
    });
    await vi.waitFor(() => expect(box).toHaveValue("Insurance"));
    await user.click(within(sheet()).getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(JSON.parse(String(writes[1]?.init.body))).toMatchObject({
      kind: "expense",
      categoryId: insurance.id,
    });
  });

  it("offers an income category to make when the rule is income", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(
      await screen.findByRole("button", { name: "Add your first rule" }),
    );
    await user.click(within(sheet()).getByRole("radio", { name: "Income" }));
    await user.type(
      within(sheet()).getByRole("combobox", { name: /^Category/ }),
      "Pay",
    );
    expect(
      await screen.findByRole("option", {
        name: "Create income category “Pay”",
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Create expense/ })).toBeNull();
  });

  it("makes the fee category an expense and the bonus category an income, from More", async () => {
    const user = userEvent.setup();
    mount({ accounts: [bank, savings] });
    await user.click(
      await screen.findByRole("button", { name: "Add your first rule" }),
    );
    await user.click(within(sheet()).getByRole("radio", { name: "Transfer" }));
    await user.selectOptions(
      within(sheet()).getByLabelText("To account"),
      savings.id,
    );
    await user.click(
      within(sheet()).getByRole("switch", {
        name: "Add a bonus to each transfer",
      }),
    );
    await user.type(
      within(sheet()).getByLabelText("Fee category"),
      "Wire fees",
    );
    expect(
      await screen.findByRole("option", {
        name: "Create expense category “Wire fees”",
      }),
    ).toBeTruthy();
    await user.type(
      within(sheet()).getByLabelText("Bonus category"),
      "Welcome",
    );
    expect(
      await screen.findByRole("option", {
        name: "Create income category “Welcome”",
      }),
    ).toBeTruthy();
  });

  it("holds Save and Delete while a made category is unconfirmed, and repeats the same request when it is chosen again", async () => {
    const user = userEvent.setup();
    const insurance = made("Insurance", "expense");
    let attempts = 0;
    const writes = mount({
      rules: [rule()],
      write: () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError("Connection lost");
        return new Response(JSON.stringify(insurance), { status: 201 });
      },
    });
    await user.click(await screen.findByRole("button", { name: /Rent/ }));
    const box = within(sheet()).getByRole("combobox", { name: /^Category/ });
    await user.clear(box);
    await user.type(box, "Insurance");
    await user.click(
      await screen.findByRole("option", { name: /Create expense category/ }),
    );
    await vi.waitFor(() =>
      expect(
        within(sheet()).getByRole("button", { name: "Save" }),
      ).toBeDisabled(),
    );
    expect(
      within(sheet()).getByRole("button", { name: "Delete rule" }),
    ).toBeDisabled();
    await user.clear(box);
    await user.type(box, "Insurance");
    await user.click(
      await screen.findByRole("option", { name: /Create expense category/ }),
    );
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    const [first, retry] = writes.map((write) => write.init);
    expect(retry?.body).toBe(first?.body);
    expect(new Headers(retry?.headers).get("Idempotency-Key")).toBe(
      new Headers(first?.headers).get("Idempotency-Key"),
    );
    await vi.waitFor(() =>
      expect(
        within(sheet()).getByRole("button", { name: "Save" }),
      ).toBeEnabled(),
    );
  });

  it("holds Save for an unconfirmed income category too", async () => {
    const user = userEvent.setup();
    mount({
      write: () => {
        throw new TypeError("Connection lost");
      },
    });
    await user.click(
      await screen.findByRole("button", { name: "Add your first rule" }),
    );
    await user.click(within(sheet()).getByRole("radio", { name: "Income" }));
    await user.type(
      within(sheet()).getByRole("combobox", { name: /^Category/ }),
      "Bonus pay",
    );
    await user.click(
      await screen.findByRole("option", { name: /Create income category/ }),
    );
    await vi.waitFor(() =>
      expect(
        within(sheet()).getByRole("button", { name: "Save" }),
      ).toBeDisabled(),
    );
  });

  it("gives the phone's one Add button its label only when it can add something", async () => {
    const seen: (PageAdd | null)[] = [];
    const wrap = (children: ReactNode) => (
      <PageAddProvider value={(add) => void seen.push(add)}>
        {children}
      </PageAddProvider>
    );
    mount({ rules: [rule()], wrap });
    await screen.findByRole("button", { name: /Rent/ });
    await vi.waitFor(() =>
      expect(seen[seen.length - 1]).toMatchObject({
        label: "Add rule",
        disabled: false,
      }),
    );
    cleanup();
    seen.length = 0;
    mount({ rules: [rule()], role: "viewer", wrap });
    await screen.findByText(/Next 1 Nov 2026/);
    expect(seen[seen.length - 1] ?? null).toBeNull();
    cleanup();
    seen.length = 0;
    mount({ rules: [rule()], timeZone: null, wrap });
    await screen.findByText("Set your time zone first.");
    expect(seen[seen.length - 1] ?? null).toBeNull();
    cleanup();
    seen.length = 0;
    mount({ wrap });
    await screen.findByText("Nothing recurring yet.");
    expect(seen[seen.length - 1] ?? null).toBeNull();
  });
});
