import {
  type CurrencyList,
  type ExchangeRate,
  newId,
  type PinnedCurrency,
} from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CurrenciesPage } from "./currencies-page";
import { addableCurrencies, rateSentence, today } from "./format";

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
) {
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const target = String(url);
    if (init?.method && init.method !== "GET") return write(target, init);
    if (target.endsWith("/currencies"))
      return new Response(JSON.stringify(data));
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
      <CurrenciesPage />
    </QueryClientProvider>,
  );
  return fetcher;
}
const calls = (fetcher: ReturnType<typeof mount>, method: string) =>
  fetcher.mock.calls.filter(([, init]) => init?.method === method);

describe("CurrenciesPage", () => {
  it("shows each currency with its newest rate and where it came from", async () => {
    mount(
      list(
        pinned("EUR", rate("EUR", "1.1217")),
        pinned("BDT", rate("BDT", "0.0083", "manual")),
        pinned("JPY", null),
      ),
    );
    expect(await screen.findByText(/Your base currency is/)).toBeTruthy();
    const euro = screen.getByRole("button", { name: /Euro/ });
    expect(euro.textContent).toContain("1 USD = 0.891504 EUR");
    expect(euro.textContent).toContain("fetched");
    expect(screen.getByRole("button", { name: /BDT/ }).textContent).toContain(
      "set by you",
    );
    expect(screen.getByRole("button", { name: /JPY/ }).textContent).toContain(
      "No rate yet",
    );
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

  it("is read-only for viewers", async () => {
    mount(list(pinned("EUR", rate("EUR", "1.1"))), "viewer");
    await screen.findByText(/Your base currency is/);
    expect(screen.queryByRole("button", { name: "Add a currency" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Euro/ })).toBeNull();
    expect(screen.getByText(/1 USD = 0.909091 EUR/)).toBeTruthy();
  });

  it("refreshes and reports updated, kept and failed currencies", async () => {
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

  it("adds a currency, then fetches its rate", async () => {
    const user = userEvent.setup();
    const fetcher = mount(list(), "owner", (url) =>
      url.endsWith("/currencies")
        ? new Response(JSON.stringify(pinned("EUR", null)), { status: 201 })
        : new Response(
            JSON.stringify({ updated: 1, keptManual: 0, failed: [] }),
          ),
    );
    await user.click(
      await screen.findByRole("button", { name: "Add a currency" }),
    );
    await user.selectOptions(await screen.findByLabelText("Currency"), "EUR");
    await user.click(screen.getByRole("button", { name: "Add currency" }));
    await waitFor(() => expect(calls(fetcher, "POST")).toHaveLength(2));
    const [pin, refresh] = calls(fetcher, "POST");
    expect(JSON.parse(String(pin?.[1]?.body))).toEqual({ code: "EUR" });
    expect(String(refresh?.[0])).toContain("/exchange-rates/refresh");
    expect(JSON.parse(String(refresh?.[1]?.body))).toEqual({ code: "EUR" });
  });

  it("does not offer the base currency or one already added", async () => {
    const user = userEvent.setup();
    mount(list(pinned("EUR", null)));
    await user.click(
      await screen.findByRole("button", { name: "Add a currency" }),
    );
    const choice = await screen.findByLabelText("Currency");
    const values = Array.from(
      choice.querySelectorAll("option"),
      (option) => option.value,
    );
    expect(values).toContain("GBP");
    expect(values).not.toContain("USD");
    expect(values).not.toContain("EUR");
  });

  it("saves a manual rate for a date with an idempotency key", async () => {
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
    const value = await screen.findByLabelText(/1 USD is worth/);
    await user.clear(value);
    await user.type(value, "1.13");
    await user.click(screen.getByRole("button", { name: "Save rate" }));
    await waitFor(() => expect(calls(fetcher, "PUT")).toHaveLength(1));
    const call = calls(fetcher, "PUT")[0];
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      code: "EUR",
      date: today(),
      // Typed as 1 USD = 1.13 EUR; stored as the base-currency value of one EUR.
      rate: "0.8849557522",
    });
    expect(new Headers(call?.[1]?.headers).get("Idempotency-Key")).toBeTruthy();
  });

  it("shows the rate with the base currency first when editing", async () => {
    const user = userEvent.setup();
    mount(list(pinned("BDT", rate("BDT", "0.00812"))));
    await user.click(await screen.findByRole("button", { name: /BDT/ }));
    const value = (await screen.findByLabelText(
      /1 USD is worth \(BDT\)/,
    )) as HTMLInputElement;
    expect(value.value).toBe("123.1527");
    expect(screen.getByText(/Latest: 1 USD = 123.1527 BDT/)).toBeTruthy();
  });

  it("rejects a bad rate before sending anything", async () => {
    const user = userEvent.setup();
    const fetcher = mount(list(pinned("EUR", rate("EUR", "1.1"))));
    await user.click(await screen.findByRole("button", { name: /Euro/ }));
    const value = await screen.findByLabelText(/1 USD is worth/);
    await user.clear(value);
    await user.type(value, "1e3");
    await user.click(screen.getByRole("button", { name: "Save rate" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(calls(fetcher, "PUT")).toHaveLength(0);
  });

  it("removes a currency only after confirming, sending its version", async () => {
    const user = userEvent.setup();
    const fetcher = mount(
      list(pinned("EUR", rate("EUR", "1.1"))),
      "owner",
      () => new Response(null, { status: 204 }),
    );
    await user.click(await screen.findByRole("button", { name: /Euro/ }));
    await user.click(screen.getByRole("button", { name: "Remove currency" }));
    expect(calls(fetcher, "DELETE")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Yes, remove EUR" }));
    await waitFor(() => expect(calls(fetcher, "DELETE")).toHaveLength(1));
    expect(JSON.parse(String(calls(fetcher, "DELETE")[0]?.[1]?.body))).toEqual({
      expectedVersion: 1,
    });
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
