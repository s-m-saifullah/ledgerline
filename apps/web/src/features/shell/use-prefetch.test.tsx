import { newId } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../../lib/query-keys";
import { category } from "../../test-support/category-fixtures";
import { usePrefetchLedgerData } from "./use-prefetch";

let requests: string[];
beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      return new Response(
        JSON.stringify({
          items: url.includes("/categories") ? [category("Food")] : [],
          nextCursor: null,
        }),
      );
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Prefetch({ ledgerId }: { ledgerId: string | undefined }) {
  usePrefetchLedgerData(ledgerId);
  return null;
}
const mount = (client: QueryClient, ledgerId: string | undefined) =>
  render(
    <QueryClientProvider client={client}>
      <Prefetch ledgerId={ledgerId} />
    </QueryClientProvider>,
  );
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe("usePrefetchLedgerData", () => {
  it("loads the active accounts and the categories once the ledger is known, so the Add sheet opens ready", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000 } },
    });
    const ledgerId = newId();
    mount(client, ledgerId);
    await flush();
    expect(
      requests.some((url) => url.includes("/accounts?status=active")),
    ).toBe(true);
    expect(requests.some((url) => url.includes("/categories"))).toBe(true);
    expect(client.getQueryData(queryKeys.categories(ledgerId))).toBeDefined();
    expect(
      client.getQueryData(queryKeys.activeAccounts(ledgerId)),
    ).toBeDefined();
  });

  it("asks for nothing before the ledger is known", async () => {
    mount(new QueryClient(), undefined);
    await flush();
    expect(requests).toEqual([]);
  });

  it("does not ask again for answers that are still fresh", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000 } },
    });
    const ledgerId = newId();
    const first = mount(client, ledgerId);
    await flush();
    const asked = requests.length;
    first.unmount();
    mount(client, ledgerId);
    await flush();
    expect(requests.length).toBe(asked);
  });

  it("stays quiet when a request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    mount(new QueryClient(), newId());
    await expect(flush()).resolves.toBeUndefined();
  });
});
