import {
  type CurrencyList,
  type ExchangeRate,
  newId,
  type PinnedCurrency,
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
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addableCurrencies, rateSentence, today } from "../../lib/rate-format";
import { type PageAdd, PageAddProvider } from "../shell/page-add";
import { CurrenciesPage } from "./currencies-page";

vi.mock("@tanstack/react-router", () => ({
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

const ledgerId = newId();
const stamp = "2026-10-10T00:00:00.000Z";
function rate(
  code: string,
  value: string,
  source: "api" | "manual" = "api",
  date = "2026-10-09",
): ExchangeRate {
  return {
    id: newId(),
    ledgerId,
    code,
    date,
    rate: value,
    source,
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
  };
}
function pinned(code: string, latest: ExchangeRate | null): PinnedCurrency {
  return {
    id: newId(),
    ledgerId,
    code,
    version: 1,
    latestRate: latest,
    createdAt: stamp,
    updatedAt: stamp,
  };
}
const list = (...items: PinnedCurrency[]): CurrencyList => ({
  baseCurrency: "USD",
  items,
});
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
});
function mount(
  data: CurrencyList,
  role = "owner",
  write: (url: string, init?: RequestInit) => Response = () =>
    new Response("{}", { status: 500 }),
  adds: (PageAdd | null)[] = [],
) {
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const target = String(url);
    if (init?.method && init.method !== "GET") return write(target, init);
    if (target.endsWith("/currencies"))
      return new Response(JSON.stringify(data));
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
      <PageAddProvider value={(add) => adds.push(add)}>
        <CurrenciesPage />
      </PageAddProvider>
    </QueryClientProvider>,
  );
  return fetcher;
}
const calls = (fetcher: ReturnType<typeof mount>, method: string) =>
  fetcher.mock.calls.filter(([, init]) => init?.method === method);

describe("CurrenciesPage", () => {
  it("shows the base currency first, then each currency with its newest rate as one hint", async () => {
    mount(
      list(
        pinned("EUR", rate("EUR", "1.1217")),
        pinned("BDT", rate("BDT", "0.0083", "manual")),
        pinned("JPY", null),
      ),
    );
    const base = (await screen.findByText("US Dollar")).closest(".ui-row");
    expect(base?.textContent).toContain("Base");
    expect(base?.tagName).toBe("DIV");
    const euro = screen.getByRole("button", { name: /Euro/ });
    expect(euro.textContent).toContain("1 USD = 0.891504 EUR · fetched");
    expect(screen.getByRole("button", { name: /BDT/ }).textContent).toContain(
      "set by you",
    );
    expect(
      screen.getByRole("button", { name: /Japanese Yen/ }).textContent,
    ).toContain("No rate yet");
    const rows = document.querySelectorAll(".ui-list > .ui-row");
    expect(rows).toHaveLength(4);
    expect(rows[0]?.textContent).toContain("US Dollar");
  });

  it("has no subtitle, eyebrow or base-currency paragraph", async () => {
    mount(list(pinned("EUR", rate("EUR", "1.1"))));
    await screen.findByText("Euro");
    expect(screen.queryByText(/Your base currency is/)).toBeNull();
    expect(screen.queryByText("MAKE IT YOURS")).toBeNull();
  });

  it("explains the empty state and disables refresh", async () => {
    mount(list());
    expect(await screen.findByText(/Only USD so far/)).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Refresh rates",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("says it could not load the currencies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response("{}", { status: 500 })),
    );
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CurrenciesPage />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText("Couldn't load your currencies."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("is read-only for viewers: no buttons, no Add, no rows to press", async () => {
    const adds: (PageAdd | null)[] = [];
    mount(list(pinned("EUR", rate("EUR", "1.1"))), "viewer", undefined, adds);
    await screen.findByText("Euro");
    expect(screen.queryByRole("button", { name: "Add currency" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh rates" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Euro/ })).toBeNull();
    expect(screen.getByText(/1 USD = 0.909091 EUR/)).toBeTruthy();
    expect(adds.at(-1) ?? null).toBeNull();
  });

  it("gives a phone's one Add the label Add currency", async () => {
    const adds: (PageAdd | null)[] = [];
    mount(list(), "owner", undefined, adds);
    await screen.findByText(/Only USD so far/);
    const add = adds.at(-1);
    expect(add).toMatchObject({ label: "Add currency", disabled: false });
    add?.onClick();
    expect(
      await screen.findByRole("dialog", { name: "Add currency" }),
    ).toBeTruthy();
  });

  it("refreshes and reports updated, kept and failed currencies in a notice", async () => {
    const user = userEvent.setup();
    const fetcher = mount(
      list(pinned("EUR", rate("EUR", "1.1")), pinned("JPY", null)),
      "owner",
      () =>
        new Response(
          JSON.stringify({ updated: 1, keptManual: 2, failed: ["JPY"] }),
        ),
    );
    await user.click(
      await screen.findByRole("button", { name: "Refresh rates" }),
    );
    expect(
      await screen.findByText(/Updated 1 rate\. Kept 2 you set yourself\./),
    ).toBeTruthy();
    expect(screen.getByText(/Couldn't fetch JPY/)).toBeTruthy();
    const call = calls(fetcher, "POST")[0];
    expect(String(call?.[0])).toContain("/exchange-rates/refresh");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({});
    expect(new Headers(call?.[1]?.headers).get("Idempotency-Key")).toBeTruthy();
  });

  it("says when a refresh could not be done", async () => {
    const user = userEvent.setup();
    mount(
      list(pinned("EUR", rate("EUR", "1.1"))),
      "owner",
      () =>
        new Response(
          JSON.stringify({
            type: "about:blank",
            title: "Bad",
            status: 502,
            detail: "Down",
          }),
          { status: 502 },
        ),
    );
    await user.click(
      await screen.findByRole("button", { name: "Refresh rates" }),
    );
    expect(
      await screen.findByText("Couldn't refresh the rates. Please try again."),
    ).toBeTruthy();
  });

  it("adds a currency, fetches its rate and says so", async () => {
    const user = userEvent.setup();
    const fetcher = mount(list(), "owner", (url) =>
      url.endsWith("/currencies")
        ? new Response(JSON.stringify(pinned("EUR", null)), { status: 201 })
        : new Response(
            JSON.stringify({ updated: 1, keptManual: 0, failed: [] }),
          ),
    );
    await user.click(
      await screen.findByRole("button", { name: "Add currency" }),
    );
    await user.selectOptions(await screen.findByLabelText("Currency"), "EUR");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Add currency",
      }),
    );
    await waitFor(() => expect(calls(fetcher, "POST")).toHaveLength(2));
    const [pin, refresh] = calls(fetcher, "POST");
    expect(JSON.parse(String(pin?.[1]?.body))).toEqual({ code: "EUR" });
    expect(String(refresh?.[0])).toContain("/exchange-rates/refresh");
    expect(JSON.parse(String(refresh?.[1]?.body))).toEqual({ code: "EUR" });
    expect(await screen.findByText("Added EUR.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reads the currencies again after a save, so the row shows the new rate", async () => {
    const user = userEvent.setup();
    const fetcher = mount(
      list(pinned("EUR", rate("EUR", "1.1217"))),
      "owner",
      () =>
        new Response(JSON.stringify(rate("EUR", "1.13", "manual")), {
          status: 201,
        }),
    );
    await user.click(await screen.findByRole("button", { name: /Euro/ }));
    const reads = () =>
      fetcher.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith("/currencies") &&
          (init?.method ?? "GET") === "GET",
      ).length;
    const before = reads();
    await user.click(await screen.findByRole("button", { name: "Save" }));
    await screen.findByText("Rate saved.");
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
  });

  it("leaves the add-a-currency sentence to those who can add one", async () => {
    mount(list(), "viewer");
    expect(await screen.findByText("Only USD so far.")).toBeTruthy();
    expect(screen.queryByText(/Add a currency/)).toBeNull();
  });

  it("opens a currency's sheet from its row and says what was saved", async () => {
    const user = userEvent.setup();
    mount(
      list(pinned("EUR", rate("EUR", "1.1217"))),
      "owner",
      () =>
        new Response(JSON.stringify(rate("EUR", "1.13", "manual")), {
          status: 201,
        }),
    );
    await user.click(await screen.findByRole("button", { name: /Euro/ }));
    expect(await screen.findByRole("dialog", { name: "Euro" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Rate saved.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("currency formatting", () => {
  it("reads a rate the way people say it", () => {
    expect(rateSentence("EUR", "1.1217", "USD")).toBe("1 USD = 0.891504 EUR");
    expect(rateSentence("BDT", "0.00812", "USD")).toBe("1 USD = 123.1527 BDT");
  });
  it("lists every currency except those already taken, by name", () => {
    const names = addableCurrencies(["USD", "EUR"]);
    expect(names.some((item) => item.code === "USD")).toBe(false);
    expect(names.some((item) => item.code === "EUR")).toBe(false);
    expect(names.find((item) => item.code === "GBP")?.name).toBe(
      "British Pound",
    );
  });
  it("uses the local calendar date", () => {
    expect(today(new Date(2026, 9, 5, 23, 59))).toBe("2026-10-05");
    expect(today(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });
});
