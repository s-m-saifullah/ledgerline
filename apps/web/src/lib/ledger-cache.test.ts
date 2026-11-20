import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetMarkers,
  invalidateLedger,
  rememberMarker,
  seenMarker,
} from "./ledger-cache";
import { queryKeys } from "./query-keys";

let client: QueryClient;
let loads: Record<string, number>;
let markerAnswer: () => Response | Promise<Response>;
const stops: Array<() => void> = [];

/** Watches a query like a mounted screen does: only watched (active) queries refetch when invalidated. */
function watch(name: string, key: readonly unknown[]) {
  loads[name] = 0;
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: () => {
      loads[name] = (loads[name] ?? 0) + 1;
      return Promise.resolve(name);
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
  stops.push(observer.subscribe(() => undefined));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  loads = {};
  markerAnswer = () =>
    new Response(JSON.stringify({ marker: "after-write" }), {
      headers: { "content-type": "application/json" },
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(markerAnswer())),
  );
  watch("budgets", queryKeys.budgets("l1", "2026-11"));
  watch("reports", queryKeys.report("l1", "spending", "2026-11"));
  watch("contacts", queryKeys.clientBook("l1", "2026-11"));
  watch("loans", queryKeys.loanPeople("l1"));
  watch("recurring", queryKeys.recurring("l1"));
  watch("accounts", queryKeys.activeAccounts("l1"));
  watch("categories", queryKeys.categories("l1"));
  watch("home", queryKeys.home("l1", "2026-11"));
  watch("transactions", queryKeys.transactionList("l1", {}));
  watch("other-ledger", queryKeys.budgets("l2", "2026-11"));
  watch("ledgers", queryKeys.ledgers);
  watch("session", queryKeys.session);
  watch("marker", queryKeys.changes("l1"));
  await settle();
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.unstubAllGlobals();
});

describe("invalidateLedger", () => {
  it("refreshes what is on screen in every area of the ledger, not only accounts, transactions and Home", async () => {
    await invalidateLedger(client, "l1");
    for (const name of [
      "budgets",
      "reports",
      "contacts",
      "loans",
      "recurring",
      "accounts",
      "categories",
      "home",
      "transactions",
    ])
      expect(loads[name], name).toBe(2);
  });

  it("leaves another ledger, the signed-in person and the change marker alone", async () => {
    await invalidateLedger(client, "l1");
    expect(loads["other-ledger"]).toBe(1);
    expect(loads.ledgers).toBe(1);
    expect(loads.session).toBe(1);
    expect(loads.marker).toBe(1);
  });

  it("marks what nobody is watching as out of date, so it loads when a screen opens", async () => {
    await client.prefetchQuery({
      queryKey: queryKeys.tags("l1"),
      queryFn: () => ["a"],
      staleTime: Number.POSITIVE_INFINITY,
    });
    await invalidateLedger(client, "l1");
    expect(client.getQueryState(queryKeys.tags("l1"))?.isInvalidated).toBe(
      true,
    );
  });

  it("remembers the ledger's new marker, so the next check does not reload everything again", async () => {
    expect(seenMarker(client, "l1")).toBeUndefined();
    await invalidateLedger(client, "l1");
    expect(seenMarker(client, "l1")).toBe("after-write");
  });

  it("reads the marker before it reloads, so a change made elsewhere in between is still noticed", async () => {
    const order: string[] = [];
    markerAnswer = () => {
      order.push("marker");
      return new Response(JSON.stringify({ marker: "m" }), {
        headers: { "content-type": "application/json" },
      });
    };
    const original = client.invalidateQueries.bind(client);
    client.invalidateQueries = ((...args: Parameters<typeof original>) => {
      order.push("invalidate");
      return original(...args);
    }) as typeof client.invalidateQueries;
    await invalidateLedger(client, "l1");
    expect(order).toEqual(["marker", "invalidate"]);
  });

  it("still reloads when the marker cannot be read, and remembers nothing", async () => {
    markerAnswer = () => Promise.reject(new TypeError("Failed to fetch"));
    await invalidateLedger(client, "l1");
    expect(loads.budgets).toBe(2);
    expect(seenMarker(client, "l1")).toBeUndefined();
  });
});

describe("the remembered markers", () => {
  it("are kept per ledger and forgotten together", () => {
    rememberMarker(client, "l1", "a");
    rememberMarker(client, "l2", "b");
    expect(seenMarker(client, "l1")).toBe("a");
    expect(seenMarker(client, "l2")).toBe("b");
    forgetMarkers(client);
    expect(seenMarker(client, "l1")).toBeUndefined();
  });
});
