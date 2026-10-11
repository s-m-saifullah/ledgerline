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
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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
      if (target.includes("/accounts"))
        return json({ items: [bank], nextCursor: null });
      if (target.includes("/categories"))
        return json({ items: [rentCategory], nextCursor: null });
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
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return writes;
}

describe("RecurringPage", () => {
  it("lists each rule with its schedule, next date and flags", async () => {
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
    const list = await screen.findByRole("list", { name: "Recurring entries" });
    const rent = within(list).getByRole("button", { name: /Rent/ });
    expect(rent.textContent).toContain(
      "Expense · Every month · Next 1 Nov 2026",
    );
    expect(
      within(list).getByRole("button", { name: /Gym/ }).textContent,
    ).toContain("Paused");
    const phone = within(list).getByRole("button", { name: /Phone/ });
    expect(phone.textContent).toContain("Every 2 weeks");
    expect(phone.textContent).toContain("1 entry needs attention");
  });

  it("asks for the time zone first and offers no add button", async () => {
    mount({ timeZone: null });
    expect(await screen.findByText("Set your time zone first")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Add a recurring entry" }),
    ).toBeNull();
  });

  it("is read-only for viewers", async () => {
    mount({ role: "viewer", rules: [rule()] });
    await screen.findByRole("list", { name: "Recurring entries" });
    expect(
      screen.queryByRole("button", { name: "Add a recurring entry" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Rent/ })).toBeNull();
    expect(screen.getByText(/Next 1 Nov 2026/)).toBeTruthy();
  });

  it("explains an empty list", async () => {
    mount();
    expect(await screen.findByText(/Nothing recurring yet/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Add a recurring entry" }),
    ).toBeTruthy();
  });

  it("adds a monthly expense as a negative amount in the account's units", async () => {
    const user = userEvent.setup();
    const saved = rule();
    const writes = mount({
      write: () => new Response(JSON.stringify(saved), { status: 201 }),
    });
    await user.click(
      await screen.findByRole("button", { name: "Add a recurring entry" }),
    );
    await user.type(await screen.findByLabelText("Name"), "Rent");
    await user.type(screen.getByLabelText(/Amount \(USD\)/), "1,200");
    await user.click(screen.getByRole("combobox", { name: /Category/ }));
    await user.click(await screen.findByRole("option", { name: "Housing" }));
    expect(screen.getByText(/Every month\. Next:/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save rule" }));
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
      await screen.findByRole("button", { name: "Add a recurring entry" }),
    );
    await user.click(await screen.findByRole("button", { name: "Save rule" }));
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

  it("pauses and deletes only on purpose, sending the rule's version", async () => {
    const user = userEvent.setup();
    const target = rule({ version: 4 });
    const writes = mount({
      rules: [target],
      write: (url) =>
        url.endsWith("/pause")
          ? new Response(JSON.stringify({ ...target, paused: true }))
          : new Response(null, { status: 204 }),
    });
    await user.click(await screen.findByRole("button", { name: /Rent/ }));
    await user.click(await screen.findByRole("button", { name: "Pause" }));
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.url).toContain(`/recurring-rules/${target.id}/pause`);
    expect(JSON.parse(String(writes[0]?.init.body))).toEqual({
      expectedVersion: 4,
    });
    await user.click(await screen.findByRole("button", { name: /Rent/ }));
    await user.click(
      await screen.findByRole("button", { name: "Delete rule" }),
    );
    expect(writes).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Yes, delete it" }));
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]?.init.method).toBe("DELETE");
    expect(JSON.parse(String(writes[1]?.init.body))).toEqual({
      expectedVersion: 4,
    });
  });
});
