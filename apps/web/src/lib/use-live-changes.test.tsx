import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liveChangesInterval, useLiveChanges } from "./use-live-changes";

let markers: string[] = [];
let accountsLoads = 0;

function respond(url: string) {
  if (url.endsWith("/changes")) {
    const marker =
      markers.length > 1 ? (markers.shift() as string) : markers[0];
    return new Response(JSON.stringify({ marker }), {
      headers: { "content-type": "application/json" },
    });
  }
  accountsLoads += 1;
  return new Response(JSON.stringify({ items: [] }), {
    headers: { "content-type": "application/json" },
  });
}

function Page({ dialog = false }: { dialog?: boolean }) {
  useLiveChanges("ledger-1");
  useQuery({
    queryKey: ["accounts", "ledger-1"],
    queryFn: () =>
      fetch("/api/v1/ledgers/ledger-1/accounts").then((r) => r.json()),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return dialog ? <div role="dialog">Editing</div> : null;
}

async function renderPage(dialog = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const page = (open: boolean) => (
    <QueryClientProvider client={client}>
      <Page dialog={open} />
    </QueryClientProvider>
  );
  const view = render(page(dialog));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  return { setDialog: (open: boolean) => view.rerender(page(open)) };
}

const tick = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(liveChangesInterval);
  });

describe("useLiveChanges", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    accountsLoads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(respond(String(input))),
      ),
    );
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reloads the data on screen when the marker moves, and not before", async () => {
    markers = ["a", "a", "b"];
    await renderPage();
    expect(accountsLoads).toBe(1);
    await tick();
    expect(accountsLoads).toBe(1);
    await tick();
    expect(accountsLoads).toBe(2);
    await tick();
    expect(accountsLoads).toBe(2);
  });

  it("waits while a dialog is open and reloads after it closes", async () => {
    markers = ["a", "b"];
    const page = await renderPage(true);
    await tick();
    expect(accountsLoads).toBe(1);
    page.setDialog(false);
    await tick();
    expect(accountsLoads).toBe(2);
  });

  it("does not ask while the page is hidden", async () => {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    markers = ["a"];
    await renderPage();
    await tick();
    const calls = (
      fetch as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.endsWith("/changes"));
    expect(calls).toEqual([]);
  });
});
