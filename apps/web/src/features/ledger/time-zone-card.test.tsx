import { newId } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimeZoneCard } from "./time-zone-card";

const ledgerId = newId();
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
});
function mount(
  role: string,
  timeZone: string | null,
  save: (init: RequestInit) => Response = () =>
    new Response("{}", { status: 500 }),
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const reads = { count: 0 };
  const onNotice = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (target: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        calls.push({ url: String(target), init });
        return save(init);
      }
      reads.count++;
      return new Response(
        JSON.stringify({
          items: [
            {
              id: ledgerId,
              name: "Personal",
              baseCurrency: "USD",
              timeZone,
              version: 4,
              role,
            },
          ],
        }),
      );
    }),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TimeZoneCard onNotice={onNotice} />
    </QueryClientProvider>,
  );
  return { calls, reads, onNotice };
}

/** The select is drawn at once but stays off until the ledger has loaded. */
async function loadedSelect() {
  const select = await screen.findByLabelText("Time zone");
  await vi.waitFor(() => expect(select).toBeEnabled());
  return select;
}

describe("ledger time zone row", () => {
  it("is one row named Time zone with a select and a one-line hint, and no Save button", async () => {
    mount("owner", "UTC");
    const select = await loadedSelect();
    expect(select).toHaveProperty("value", "UTC");
    expect(select).toHaveAccessibleDescription("Decides what today is");
    expect(screen.getByRole("heading", { name: "Ledger" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
  });

  it("shows a placeholder when no zone is set, and that choice cannot be picked again", async () => {
    mount("owner", null);
    const select = await loadedSelect();
    expect(select).toHaveProperty("value", "");
    expect(
      screen.getByRole("option", { name: "Choose a time zone" }),
    ).toBeDisabled();
  });

  it("saves the chosen zone at once, with the ledger's version and one key, and says so", async () => {
    const user = userEvent.setup();
    const { calls, reads, onNotice } = mount(
      "owner",
      "UTC",
      () =>
        new Response(
          JSON.stringify({
            id: ledgerId,
            name: "Personal",
            baseCurrency: "USD",
            timeZone: "America/Chicago",
            version: 5,
            role: "owner",
          }),
        ),
    );
    await user.selectOptions(await loadedSelect(), "America/Chicago");
    await vi.waitFor(() =>
      expect(onNotice).toHaveBeenCalledWith("Time zone saved."),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`/api/v1/ledgers/${ledgerId}`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      timeZone: "America/Chicago",
      expectedVersion: 4,
    });
    expect(
      new Headers(calls[0]?.init.headers).get("idempotency-key"),
    ).toBeTruthy();
    // The ledger is read again, so the row shows what the server now holds.
    await vi.waitFor(() => expect(reads.count).toBeGreaterThan(1));
  });

  it("shows an alert and no notice when the save fails, and the row keeps the saved zone", async () => {
    const user = userEvent.setup();
    const { calls, onNotice } = mount("owner", "UTC");
    const select = await loadedSelect();
    await user.selectOptions(select, "America/Chicago");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "We couldn't save that. Please try again.",
    );
    expect(calls).toHaveLength(1);
    expect(onNotice).not.toHaveBeenCalled();
    expect(select).toHaveProperty("value", "UTC");
  });

  it("is switched off for editors and viewers, with the reason as its hint", async () => {
    mount("viewer", "Asia/Dhaka");
    const select = await screen.findByLabelText("Time zone");
    await vi.waitFor(() =>
      expect(select).toHaveProperty("value", "Asia/Dhaka"),
    );
    expect(select).toBeDisabled();
    expect(select).toHaveAccessibleDescription(
      "Only the owner can change this",
    );
  });

  it("still shows a saved zone that this browser does not list", async () => {
    mount("owner", "US/Pacific");
    const select = await loadedSelect();
    expect(select).toHaveProperty("value", "US/Pacific");
    expect(screen.getByRole("option", { name: "US/Pacific" })).toBeTruthy();
  });

  it("says when the ledger cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TimeZoneCard onNotice={vi.fn()} />
      </QueryClientProvider>,
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn't load your ledger.",
    );
    expect(screen.getByLabelText("Time zone")).toBeDisabled();
  });
});
