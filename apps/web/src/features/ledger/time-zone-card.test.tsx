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
  vi.stubGlobal(
    "fetch",
    vi.fn(async (target: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        calls.push({ url: String(target), init });
        return save(init);
      }
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
      <TimeZoneCard />
    </QueryClientProvider>,
  );
  return calls;
}

describe("ledger time zone card", () => {
  it("says no time zone is set and offers to save one", async () => {
    mount("owner", null);
    expect(await screen.findByText(/No time zone yet/)).toBeTruthy();
    expect(screen.getByLabelText("Time zone")).toBeTruthy();
  });

  it("saves the chosen zone with the ledger's version and one key", async () => {
    const user = userEvent.setup();
    const calls = mount(
      "owner",
      "UTC",
      () => new Response("{}", { status: 500 }),
    );
    await user.selectOptions(
      await screen.findByLabelText("Time zone"),
      "America/Chicago",
    );
    await user.click(screen.getByRole("button", { name: "Save time zone" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`/api/v1/ledgers/${ledgerId}`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      timeZone: "America/Chicago",
      expectedVersion: 4,
    });
  });

  it("shows a read-only sentence to editors and viewers", async () => {
    mount("viewer", "Asia/Dhaka");
    expect(
      await screen.findByText("Today follows the Asia/Dhaka time zone."),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Time zone")).toBeNull();
    expect(screen.getByText("Only the owner can change this.")).toBeTruthy();
  });
});
