import {
  type BudgetLine,
  type BudgetMonthView,
  newId,
} from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentMonth } from "../home/month";
import { PrivacyContext } from "../shell/preferences";
import { parseBudgetAmount } from "./budget-editor";
import { BudgetsPage, usedShare } from "./budgets-page";
import { shiftMonth } from "./month";

const ledgerId = newId();
const usd = (amount: number) => ({ amount, currency: "USD" as const });
const month = currentMonth();
const stamp = "2026-10-01T00:00:00.000Z";
function line(
  name: string,
  budget: number | null,
  spent: number,
  carriedIn = 0,
  rollover = false,
): BudgetLine {
  const categoryId = newId();
  return {
    categoryId,
    name,
    icon: null,
    color: null,
    archived: false,
    budget:
      budget === null
        ? null
        : {
            id: newId(),
            ledgerId,
            categoryId,
            month,
            amount: usd(budget),
            rollover,
            version: 1,
            createdAt: stamp,
            updatedAt: stamp,
          },
    carriedIn: usd(carriedIn),
    spent: usd(spent),
    left: budget === null ? null : usd(budget + carriedIn - spent),
  };
}
function view(items: BudgetLine[]): BudgetMonthView {
  const budgeted = items.filter((item) => item.budget);
  const sum = (pick: (item: BudgetLine) => number) =>
    budgeted.reduce((total, item) => total + pick(item), 0);
  return {
    month,
    items,
    totals: {
      budgeted: usd(sum((item) => item.budget?.amount.amount ?? 0)),
      carriedIn: usd(sum((item) => item.carriedIn.amount)),
      spent: usd(sum((item) => item.spent.amount)),
      left: usd(sum((item) => item.left?.amount ?? 0)),
      unbudgetedSpent: usd(
        items
          .filter((item) => !item.budget)
          .reduce((total, item) => total + item.spent.amount, 0),
      ),
    },
  };
}
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
});
function mount(
  data: BudgetMonthView,
  { role = "owner", privacy = false } = {},
  write: (url: string, init?: RequestInit) => Response = () =>
    new Response("{}", { status: 500 }),
) {
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const target = String(url);
    if (init?.method && init.method !== "GET") return write(target, init);
    if (target.includes("/budgets")) return new Response(JSON.stringify(data));
    return new Response(
      JSON.stringify({
        items: [{ id: ledgerId, name: "Personal", baseCurrency: "USD", role }],
      }),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PrivacyContext value={privacy}>
        <BudgetsPage />
      </PrivacyContext>
    </QueryClientProvider>,
  );
  return fetcher;
}

describe("BudgetsPage", () => {
  it("shows what is left, marks overspending, and notes carried-over money", async () => {
    mount(
      view([
        line("Food", 50000, 12000),
        line("Rent", 90000, 100000),
        line("Fun", 10000, 2000, 3000, true),
        line("Travel", null, 4500),
      ]),
    );
    expect(await screen.findByText("Left this month")).toBeTruthy();
    // Summary: 380 left on Food, 100 over on Rent, 110 left on Fun.
    expect(screen.getByText("$390.00")).toBeTruthy();
    expect(screen.getByText("$380.00")).toBeTruthy();
    // Rent is $100 over and shown as overspending, not as a negative balance.
    const rent = screen.getByRole("button", { name: /Rent/ });
    expect(rent.textContent).toContain("$100.00 over");
    expect(rent.querySelector(".budget-over")).toBeTruthy();
    expect(rent.querySelector(".budget-bar.over")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Fun/ }).textContent).toContain(
      "Carried over $30.00",
    );
    expect(
      screen.getByRole("button", { name: /Travel/ }).textContent,
    ).toContain("Tap to set a budget");
    expect(screen.getByText(/Spent without a budget/).textContent).toContain(
      "$45.00",
    );
  });

  it("hides every amount in privacy mode", async () => {
    mount(view([line("Food", 50000, 12000)]), { privacy: true });
    await screen.findByText("Left this month");
    expect(document.body.textContent).not.toMatch(/\$\d/);
    expect(screen.getAllByText("Amount hidden").length).toBeGreaterThan(0);
  });

  it("is read-only for viewers", async () => {
    mount(view([line("Food", 50000, 12000)]), { role: "viewer" });
    await screen.findByText("Left this month");
    expect(screen.queryByRole("button", { name: /Food/ })).toBeNull();
    expect(screen.getByText("Food")).toBeTruthy();
  });

  it("offers to copy last month when nothing is budgeted", async () => {
    const user = userEvent.setup();
    const fetcher = mount(
      view([line("Food", null, 0)]),
      undefined,
      () => new Response(JSON.stringify({ items: [] }), { status: 201 }),
    );
    expect(await screen.findByText(/No budgets for/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Copy from/ }));
    expect(await screen.findByText(/Nothing to copy/)).toBeTruthy();
    const call = fetcher.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      fromMonth: shiftMonth(month, -1),
      toMonth: month,
    });
  });

  it("saves a new budget with an idempotency key", async () => {
    const user = userEvent.setup();
    const food = line("Food", null, 0);
    const fetcher = mount(view([food]), undefined, (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: newId(),
          ledgerId,
          categoryId: body.categoryId,
          month: body.month,
          amount: body.amount,
          rollover: body.rollover,
          version: 1,
          createdAt: stamp,
          updatedAt: stamp,
        }),
        { status: 201 },
      );
    });
    await user.click(await screen.findByRole("button", { name: /Food/ }));
    await user.type(
      await screen.findByLabelText(/Budget for the month/),
      "250.5",
    );
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Save budget" }));
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(([, init]) => init?.method === "PUT"),
      ).toBe(true),
    );
    const call = fetcher.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      categoryId: food.categoryId,
      month,
      amount: { amount: 25050, currency: "USD" },
      rollover: true,
    });
    const headers = new Headers(call?.[1]?.headers);
    expect(headers.get("Idempotency-Key")).toBeTruthy();
  });

  it("removes a budget only after confirming, sending its version", async () => {
    const user = userEvent.setup();
    const food = line("Food", 50000, 0);
    const fetcher = mount(
      view([food]),
      undefined,
      () => new Response(null, { status: 204 }),
    );
    await user.click(await screen.findByRole("button", { name: /Food/ }));
    await user.click(screen.getByRole("button", { name: "Remove budget" }));
    expect(
      fetcher.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
    await user.click(screen.getByRole("button", { name: "Yes, remove it" }));
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(([, init]) => init?.method === "DELETE"),
      ).toBe(true),
    );
    const call = fetcher.mock.calls.find(
      ([, init]) => init?.method === "DELETE",
    );
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ expectedVersion: 1 });
  });

  it("asks for a reload when the budget changed elsewhere", async () => {
    const user = userEvent.setup();
    mount(
      view([line("Food", 50000, 0)]),
      undefined,
      () =>
        new Response(
          JSON.stringify({
            type: "about:blank",
            title: "Conflict",
            status: 409,
            detail: "This record changed. Reload it before trying again.",
            errors: [],
          }),
          { status: 409 },
        ),
    );
    await user.click(await screen.findByRole("button", { name: /Food/ }));
    await user.click(screen.getByRole("button", { name: "Save budget" }));
    expect(
      await screen.findByRole("button", { name: "Reload budgets" }),
    ).toBeTruthy();
  });
});

describe("budget helpers", () => {
  it("parses typed amounts", () => {
    expect(parseBudgetAmount("250")).toEqual({ cents: 25000 });
    expect(parseBudgetAmount("$1,200.50")).toEqual({ cents: 120050 });
    expect(parseBudgetAmount(".5")).toEqual({ cents: 50 });
    expect(parseBudgetAmount("0")).toEqual({ cents: 0 });
    for (const bad of ["", "abc", "-5", "1.234"])
      expect("error" in parseBudgetAmount(bad)).toBe(true);
  });
  it("caps the progress bar and handles a zero allowance", () => {
    expect(usedShare(line("A", 10000, 5000))).toBe(0.5);
    expect(usedShare(line("B", 10000, 30000))).toBe(1);
    expect(usedShare(line("C", 0, 0))).toBe(0);
    expect(usedShare(line("D", 0, 100))).toBe(1);
    expect(usedShare(line("E", 1000, 500, -2000))).toBe(1);
    expect(usedShare(line("F", null, 500))).toBe(0);
  });
  it("shifts months across year boundaries", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-10", 0)).toBe("2026-10");
  });
});
