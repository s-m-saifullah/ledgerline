import {
  type BudgetLine,
  type BudgetMonthView,
  newId,
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
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentMonth, shiftMonth } from "../../lib/month";
import { PrivacyContext } from "../../lib/preferences";
import { BudgetsPage } from "./budgets-page";
import { parseBudgetAmount } from "./limit-sheet";

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
  vi.useRealTimers();
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
        items: [
          {
            id: ledgerId,
            name: "Personal",
            baseCurrency: "USD",
            timeZone: null,
            version: 1,
            role,
          },
        ],
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

const problem = (status: number) =>
  new Response(
    JSON.stringify({
      type: "about:blank",
      title: "Conflict",
      status,
      detail: "This record changed. Reload it before trying again.",
      errors: [],
    }),
    { status },
  );
const saved = (_url: string, init?: RequestInit) => {
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
};
const writes = (fetcher: ReturnType<typeof mount>, method: string) =>
  fetcher.mock.calls.filter(([, init]) => init?.method === method);
/** A hint whose words are split around an amount: match the element's whole text. */
const hint = (text: RegExp) => (_: string, element: Element | null) =>
  !!element?.classList.contains("ui-row-hint") &&
  text.test(element.textContent ?? "");
const rowNames = () =>
  screen
    .getAllByRole("button", { name: /left|over/ })
    .map((row) => row.querySelector(".ui-row-title")?.textContent);

describe("BudgetsPage", () => {
  it("is headed Budgets with a month control and no eyebrow", async () => {
    mount(view([line("Food", 50000, 12000)]));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Budgets" }),
    ).toBeTruthy();
    expect(screen.queryByText("YOUR PERSONAL LEDGER")).toBeNull();
    expect(screen.getByRole("button", { name: "Previous month" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next month" })).toBeTruthy();
  });

  it("follows the month control to another month", async () => {
    const user = userEvent.setup();
    const fetcher = mount(view([line("Food", 50000, 12000)]));
    await screen.findByText("Left this month");
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(([url]) =>
          String(url).includes(`month=${shiftMonth(month, -1)}`),
        ),
      ).toBe(true),
    );
  });

  it("shows what is left in the hero with how much of it is used", async () => {
    mount(
      view([
        line("Food", 50000, 12000),
        line("Rent", 90000, 100000),
        line("Fun", 10000, 2000, 3000, true),
        line("Travel", null, 4500),
      ]),
    );
    expect(await screen.findByText("Left this month")).toBeTruthy();
    // 380 left on Food, 100 over on Rent, 110 left on Fun.
    expect(screen.getByText("$390.00")).toBeTruthy();
    // Spent 1,140 of 1,500 plus 30 carried in: 75 per cent.
    expect(screen.getByText(/75% used/)).toBeTruthy();
    expect(screen.getByText(/Spent without a budget/).textContent).toContain(
      "$45.00",
    );
    expect(document.querySelector(".ui-hero-danger")).toBeNull();
  });

  it("turns the hero red when the month is overspent", async () => {
    mount(view([line("Rent", 90000, 100000)]));
    await screen.findByText("Left this month");
    expect(document.querySelector(".ui-hero")).toHaveClass("ui-hero-danger");
    expect(screen.getByText(/111% used/)).toBeTruthy();
  });

  it("is not red when exactly nothing is left", async () => {
    mount(view([line("Food", 10000, 10000)]));
    await screen.findByText("Left this month");
    expect(document.querySelector(".ui-hero")).not.toHaveClass(
      "ui-hero-danger",
    );
    expect(screen.getByText(/100% used/)).toBeTruthy();
  });

  it("leaves out the unbudgeted line when nothing was spent without a budget", async () => {
    mount(view([line("Food", 50000, 12000), line("Gifts", null, 0)]));
    await screen.findByText("Left this month");
    expect(screen.queryByText(/Spent without a budget/)).toBeNull();
  });

  it("lists the overspent first, then the most spent, one hint each", async () => {
    mount(
      view([
        line("Fun", 8000, 5499),
        line("Transport", 15000, 21215, 1500),
        line("Food", 60000, 41635),
        line("Home", 170000, 159450),
      ]),
    );
    await screen.findByText("Left this month");
    expect(rowNames()).toEqual(["Transport", "Home", "Food", "Fun"]);
    const transport = screen.getByRole("button", { name: /Transport/ });
    expect(transport.textContent).toContain("$47.15 over");
    expect(transport.textContent).toContain(
      "$212.15 of $165.00 · Carried over $15.00",
    );
    expect(transport.querySelector(".ui-bar")).toHaveClass("ui-bar-over");
    expect(screen.getByRole("button", { name: /Home/ }).textContent).toContain(
      "$1,594.50 of $1,700.00",
    );
    expect(
      screen.getByRole("button", { name: /Home/ }).textContent,
    ).not.toContain("Carried");
  });

  it("warns on the bar from 90 per cent and says overspent for a negative carry-over", async () => {
    mount(
      view([
        line("Food", 10000, 9500),
        line("Fun", 10000, 1000, -2000),
        line("Home", 10000, 2000),
      ]),
    );
    await screen.findByText("Left this month");
    expect(
      screen.getByRole("button", { name: /Food/ }).querySelector(".ui-bar"),
    ).toHaveClass("ui-bar-near");
    expect(
      screen.getByRole("button", { name: /Home/ }).querySelector(".ui-bar"),
    ).not.toHaveClass("ui-bar-near", "ui-bar-over");
    expect(screen.getByRole("button", { name: /Fun/ }).textContent).toContain(
      "· Overspent $20.00",
    );
  });

  it("folds every category without a budget into one closed line", async () => {
    mount(
      view([
        line("Food", 50000, 12000),
        line("Travel", null, 4500),
        line("Gifts", null, 0),
      ]),
    );
    await screen.findByText("Left this month");
    const fold = screen.getByText("2 without a budget").closest("details");
    expect(fold).not.toBeNull();
    expect(fold).not.toHaveAttribute("open");
    expect(rowNames()).toEqual(["Food"]);
    expect(fold?.textContent).toContain("Travel");
    expect(fold?.textContent).toContain("$45.00");
    expect(fold?.textContent).toContain("Gifts");
    // A category that spent nothing shows its name and no figure.
    const gifts = within(fold as HTMLElement)
      .getByText("Gifts")
      .closest(".ui-row");
    expect(gifts?.querySelector(".ui-row-end")).toBeNull();
    expect(
      within(fold as HTMLElement)
        .getByText("Travel")
        .closest(".ui-row")
        ?.querySelector(".ui-row-end")?.textContent,
    ).toBe("$45.00");
  });

  it("hides every amount in privacy mode", async () => {
    mount(view([line("Food", 50000, 12000), line("Travel", null, 4500)]), {
      privacy: true,
    });
    await screen.findByText("Left this month");
    expect(document.body.textContent).not.toMatch(/\$\d/);
    expect(screen.getAllByText("Amount hidden").length).toBeGreaterThan(0);
  });

  it("is read-only for viewers", async () => {
    mount(view([line("Food", 50000, 12000), line("Travel", null, 4500)]), {
      role: "viewer",
    });
    await screen.findByText("Left this month");
    expect(screen.queryByRole("button", { name: /Food/ })).toBeNull();
    expect(screen.getByText("Food")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Travel/ })).toBeNull();
    expect(screen.getByText("Travel")).toBeTruthy();
  });

  it("says how many days are left, in the current month only", async () => {
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-10-28T12:00:00"),
    });
    const user = userEvent.setup();
    mount(view([line("Food", 50000, 12000)]));
    expect(await screen.findByText(/24% used · 3 days left/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(screen.queryByText(/days left/)).toBeNull());
    expect(screen.getByText(/24% used/)).toBeTruthy();
  });

  it("says 1 day left and Last day at the end of the month", async () => {
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-10-30T12:00:00"),
    });
    mount(view([line("Food", 50000, 12000)]));
    expect(await screen.findByText(/24% used · 1 day left/)).toBeTruthy();
    cleanup();
    vi.setSystemTime(new Date("2026-10-31T12:00:00"));
    mount(view([line("Food", 50000, 12000)]));
    expect(await screen.findByText(/24% used · Last day/)).toBeTruthy();
  });

  it("asks for an expense category when there are none", async () => {
    mount(view([]));
    expect(
      await screen.findByText(
        "Add an expense category first, then budget it here.",
      ),
    ).toBeTruthy();
  });

  it("shows a load error with Try again", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <BudgetsPage />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Couldn't load your budgets.")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));
  });
});

describe("an empty month", () => {
  it("says so and offers to copy last month, with the fold open", async () => {
    const user = userEvent.setup();
    const fetcher = mount(
      view([line("Food", null, 0), line("Travel", null, 300)]),
      undefined,
      () => new Response(JSON.stringify({ items: [] }), { status: 201 }),
    );
    expect(await screen.findByText(/No budgets for/)).toBeTruthy();
    expect(screen.queryByText("Left this month")).toBeNull();
    expect(
      screen.getByText("2 without a budget").closest("details"),
    ).toHaveAttribute("open");
    await user.click(screen.getByRole("button", { name: /Copy from/ }));
    expect(await screen.findByText(/Nothing to copy/)).toBeTruthy();
    const call = writes(fetcher, "POST")[0];
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      fromMonth: shiftMonth(month, -1),
      toMonth: month,
    });
  });

  it("reports how many budgets were copied", async () => {
    const user = userEvent.setup();
    const copied = (id: string) => ({
      id,
      ledgerId,
      categoryId: newId(),
      month,
      amount: usd(100),
      rollover: false,
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
    });
    mount(
      view([line("Food", null, 0)]),
      undefined,
      () =>
        new Response(
          JSON.stringify({ items: [copied(newId()), copied(newId())] }),
          { status: 201 },
        ),
    );
    await user.click(await screen.findByRole("button", { name: /Copy from/ }));
    expect(await screen.findByText(/Copied 2 budgets from/)).toBeTruthy();
  });

  it("says budget, not budgets, when one was copied", async () => {
    const user = userEvent.setup();
    mount(
      view([line("Food", null, 0)]),
      undefined,
      () =>
        new Response(
          JSON.stringify({
            items: [
              {
                id: newId(),
                ledgerId,
                categoryId: newId(),
                month,
                amount: usd(100),
                rollover: false,
                version: 1,
                createdAt: stamp,
                updatedAt: stamp,
              },
            ],
          }),
          { status: 201 },
        ),
    );
    await user.click(await screen.findByRole("button", { name: /Copy from/ }));
    expect(await screen.findByText(/Copied 1 budget from/)).toBeTruthy();
  });

  it("says it could not copy when the request fails", async () => {
    const user = userEvent.setup();
    mount(view([line("Food", null, 0)]), undefined, () => problem(500));
    await user.click(await screen.findByRole("button", { name: /Copy from/ }));
    expect(
      await screen.findByText("Couldn't copy the budgets. Please try again."),
    ).toBeTruthy();
  });

  it("gives a viewer a sentence and no button", async () => {
    mount(view([line("Food", null, 0)]), { role: "viewer" });
    expect(
      await screen.findByText("Nothing has been budgeted for this month."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Copy from/ })).toBeNull();
  });

  it("does not offer to copy when a budget exists", async () => {
    mount(view([line("Food", 50000, 0)]));
    await screen.findByText("Left this month");
    expect(screen.queryByRole("button", { name: /Copy from/ })).toBeNull();
  });
});

describe("the Set limit sheet", () => {
  it("opens on a row with the category, what it spent and a big amount", async () => {
    const user = userEvent.setup();
    mount(view([line("Food", 50000, 12000)]));
    await user.click(await screen.findByRole("button", { name: /Food/ }));
    const sheet = await screen.findByRole("dialog", { name: "Set limit" });
    expect(within(sheet).getByText("Food")).toBeTruthy();
    expect(
      within(sheet).getByText(hint(/^Spent \$120\.00 this month$/)),
    ).toBeTruthy();
    expect(within(sheet).getByLabelText(/Budget for the month/)).toHaveValue(
      "500.00",
    );
    expect(sheet.querySelector(".entry-amount-code")).toHaveTextContent("USD");
    expect(
      within(sheet).getByRole("switch", { name: "Carry over what is left" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("starts the carry-over switch from the saved budget", async () => {
    const user = userEvent.setup();
    mount(view([line("Fun", 10000, 2000, 3000, true)]));
    await user.click(await screen.findByRole("button", { name: /Fun/ }));
    expect(
      await screen.findByRole("switch", { name: "Carry over what is left" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("fills the amount from a preset without saving", async () => {
    const user = userEvent.setup();
    const fetcher = mount(view([line("Food", null, 0)]));
    await user.click(await screen.findByRole("button", { name: /Food/ }));
    for (const [label, value] of [
      ["$50", "50.00"],
      ["$100", "100.00"],
      ["$150", "150.00"],
      ["$250", "250.00"],
    ] as const) {
      await user.click(await screen.findByRole("button", { name: label }));
      expect(screen.getByLabelText(/Budget for the month/)).toHaveValue(value);
    }
    expect(screen.getByRole("button", { name: "$250" })).not.toHaveAttribute(
      "aria-pressed",
    );
    expect(writes(fetcher, "PUT")).toHaveLength(0);
  });

  it("saves a new limit with an idempotency key, says so and closes", async () => {
    const user = userEvent.setup();
    const food = line("Food", null, 0);
    const fetcher = mount(view([food]), undefined, saved);
    await user.click(await screen.findByRole("button", { name: /Food/ }));
    await user.type(
      await screen.findByLabelText(/Budget for the month/),
      "250.5",
    );
    await user.click(screen.getByRole("switch", { name: /Carry over/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(fetcher, "PUT")).toHaveLength(1));
    const call = writes(fetcher, "PUT")[0];
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      categoryId: food.categoryId,
      month,
      amount: { amount: 25050, currency: "USD" },
      rollover: true,
    });
    expect(new Headers(call?.[1]?.headers).get("Idempotency-Key")).toBeTruthy();
    expect(await screen.findByText("Limit saved.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("sends the saved version when it changes a limit", async () => {
    const user = userEvent.setup();
    const food = line("Food", 50000, 0);
    const fetcher = mount(view([food]), undefined, saved);
    await user.click(await screen.findByRole("button", { name: /Food/ }));
    const field = await screen.findByLabelText(/Budget for the month/);
    await user.clear(field);
    await user.type(field, "600");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(fetcher, "PUT")).toHaveLength(1));
    expect(
      JSON.parse(String(writes(fetcher, "PUT")[0]?.[1]?.body)),
    ).toMatchObject({ amount: { amount: 60000 }, expectedVersion: 1 });
  });

  it("explains an empty amount without sending it, and clears the message on typing", async () => {
    const user = userEvent.setup();
    const fetcher = mount(view([line("Food", null, 0)]), undefined, saved);
    await user.click(await screen.findByRole("button", { name: /Food/ }));
    await user.click(await screen.findByRole("button", { name: "Save" }));
    const field = screen.getByLabelText(/Budget for the month/);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Enter a budget amount.",
    );
    expect(field).toHaveAttribute("aria-invalid", "true");
    await user.type(field, "5");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(field).toHaveAttribute("aria-invalid", "false");
    expect(writes(fetcher, "PUT")).toHaveLength(0);
  });

  it("has no Remove limit for a category without one", async () => {
    const user = userEvent.setup();
    mount(view([line("Food", null, 0)]));
    await user.click(await screen.findByRole("button", { name: /Food/ }));
    await screen.findByRole("dialog", { name: "Set limit" });
    expect(screen.queryByRole("button", { name: "Remove limit" })).toBeNull();
  });

  it("removes a limit in one tap, sending its version, and says so", async () => {
    const user = userEvent.setup();
    const food = line("Food", 50000, 0);
    const fetcher = mount(
      view([food]),
      undefined,
      () => new Response(null, { status: 204 }),
    );
    await user.click(await screen.findByRole("button", { name: /Food/ }));
    await user.click(
      await screen.findByRole("button", { name: "Remove limit" }),
    );
    await waitFor(() => expect(writes(fetcher, "DELETE")).toHaveLength(1));
    expect(JSON.parse(String(writes(fetcher, "DELETE")[0]?.[1]?.body))).toEqual(
      { expectedVersion: 1 },
    );
    expect(await screen.findByText("Limit removed")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("asks for a reload when the limit changed elsewhere", async () => {
    const user = userEvent.setup();
    mount(view([line("Food", 50000, 0)]), undefined, () => problem(409));
    await user.click(await screen.findByRole("button", { name: /Food/ }));
    await user.click(await screen.findByRole("button", { name: "Save" }));
    expect(
      await screen.findByRole("button", { name: "Reload budgets" }),
    ).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "changed somewhere else",
    );
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove limit" })).toBeNull();
  });

  it("retries an unconfirmed save with the same key", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const fetcher = mount(
      view([line("Food", 50000, 0)]),
      undefined,
      (url, init) =>
        ++attempts === 1
          ? new Response("{}", { status: 500 })
          : saved(url, init),
    );
    await user.click(await screen.findByRole("button", { name: /Food/ }));
    await user.click(await screen.findByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "We couldn't confirm that",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(fetcher, "PUT")).toHaveLength(2));
    const keys = writes(fetcher, "PUT").map(([, init]) =>
      new Headers(init?.headers).get("Idempotency-Key"),
    );
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it("sends a new key when the amount changed after an unconfirmed save", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const fetcher = mount(
      view([line("Food", 50000, 0)]),
      undefined,
      (url, init) =>
        ++attempts === 1
          ? new Response("{}", { status: 500 })
          : saved(url, init),
    );
    await user.click(await screen.findByRole("button", { name: /Food/ }));
    await user.click(await screen.findByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "$150" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(fetcher, "PUT")).toHaveLength(2));
    const keys = writes(fetcher, "PUT").map(([, init]) =>
      new Headers(init?.headers).get("Idempotency-Key"),
    );
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("removes the limit, not the unconfirmed save, when Remove limit is tapped after one", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const fetcher = mount(
      view([line("Food", 50000, 0)]),
      undefined,
      (_u, init) =>
        init?.method === "PUT" && ++attempts === 1
          ? new Response("{}", { status: 500 })
          : new Response(null, { status: 204 }),
    );
    await user.click(await screen.findByRole("button", { name: /Food/ }));
    await user.click(await screen.findByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Remove limit" }));
    await waitFor(() => expect(writes(fetcher, "DELETE")).toHaveLength(1));
    expect(writes(fetcher, "PUT")).toHaveLength(1);
  });

  it("takes the message away when a preset is tapped", async () => {
    const user = userEvent.setup();
    mount(view([line("Food", null, 0)]));
    await user.click(await screen.findByRole("button", { name: /Food/ }));
    await user.click(await screen.findByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "$100" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("starts on the amount", async () => {
    const user = userEvent.setup();
    mount(view([line("Food", 50000, 0)]));
    await user.click(await screen.findByRole("button", { name: /Food/ }));
    await waitFor(() =>
      expect(screen.getByLabelText(/Budget for the month/)).toHaveFocus(),
    );
  });

  it("freezes the fields when the limit changed elsewhere", async () => {
    const user = userEvent.setup();
    mount(view([line("Food", 50000, 0)]), undefined, () => problem(409));
    await user.click(await screen.findByRole("button", { name: /Food/ }));
    await user.click(await screen.findByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Reload budgets" });
    expect(screen.getByLabelText(/Budget for the month/)).toBeDisabled();
    expect(screen.getByRole("switch", { name: /Carry over/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "$50" })).toBeDisabled();
  });

  it("sends a new key when the carry-over changed after an unconfirmed save", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const fetcher = mount(
      view([line("Food", 50000, 0)]),
      undefined,
      (url, init) =>
        ++attempts === 1
          ? new Response("{}", { status: 500 })
          : saved(url, init),
    );
    await user.click(await screen.findByRole("button", { name: /Food/ }));
    await user.click(await screen.findByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("switch", { name: /Carry over/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(fetcher, "PUT")).toHaveLength(2));
    const keys = writes(fetcher, "PUT").map(([, init]) =>
      new Headers(init?.headers).get("Idempotency-Key"),
    );
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("starts a new request after the server refused one, so a fix is not replayed", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const fetcher = mount(
      view([line("Food", 50000, 0)]),
      undefined,
      (url, init) => (++attempts === 1 ? problem(422) : saved(url, init)),
    );
    await user.click(await screen.findByRole("button", { name: /Food/ }));
    await user.click(await screen.findByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "This record changed",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(fetcher, "PUT")).toHaveLength(2));
    const keys = writes(fetcher, "PUT").map(([, init]) =>
      new Headers(init?.headers).get("Idempotency-Key"),
    );
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("opens from a folded category for a writer", async () => {
    const user = userEvent.setup();
    mount(view([line("Food", 50000, 0), line("Travel", null, 4500)]));
    await user.click(await screen.findByText("1 without a budget"));
    await user.click(await screen.findByRole("button", { name: /Travel/ }));
    const sheet = await screen.findByRole("dialog", { name: "Set limit" });
    expect(
      within(sheet).getByText(hint(/^Spent \$45\.00 this month$/)),
    ).toBeTruthy();
  });

  it("closes with Cancel without saving", async () => {
    const user = userEvent.setup();
    const fetcher = mount(view([line("Food", 50000, 0)]));
    await user.click(await screen.findByRole("button", { name: /Food/ }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes(fetcher, "PUT")).toHaveLength(0);
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
  it("shifts months across year boundaries", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-10", 0)).toBe("2026-10");
  });
});
