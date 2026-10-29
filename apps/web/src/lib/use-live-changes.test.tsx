import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  liveChangesInterval,
  type SyncState,
  syncState,
  useLiveChanges,
} from "./use-live-changes";

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

describe("syncState", () => {
  it.each([
    [{ online: true, checkFailed: false, reloading: false }, "synced"],
    [{ online: true, checkFailed: false, reloading: true }, "updating"],
    [{ online: false, checkFailed: false, reloading: false }, "offline"],
    [{ online: true, checkFailed: true, reloading: false }, "offline"],
    [{ online: false, checkFailed: true, reloading: true }, "offline"],
    [{ online: true, checkFailed: true, reloading: true }, "offline"],
  ] as const)("%j is %s", (input, expected) => {
    expect(syncState(input)).toBe(expected);
  });
});

describe("the sync state the hook reports", () => {
  let seen: SyncState = "synced";
  let failing = false;
  function Probe() {
    seen = useLiveChanges("ledger-1");
    return null;
  }
  async function mount() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
  }
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    failing = false;
    markers = ["a"];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        failing
          ? Promise.reject(new TypeError("Failed to fetch"))
          : Promise.resolve(respond(String(input))),
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

  it("is synced after a check that worked", async () => {
    await mount();
    expect(seen).toBe("synced");
  });

  it("is offline when the check fails, and synced again when it works", async () => {
    await mount();
    failing = true;
    await tick();
    expect(seen).toBe("offline");
    failing = false;
    await tick();
    expect(seen).toBe("synced");
  });

  it("is offline while the browser says it is offline, and follows its events", async () => {
    await mount();
    const onLine = vi.spyOn(navigator, "onLine", "get");
    onLine.mockReturnValue(false);
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(seen).toBe("offline");
    onLine.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    onLine.mockRestore();
    expect(seen).toBe("synced");
  });
});

describe("updating while a reload runs", () => {
  let seen: SyncState = "synced";
  function Probe() {
    seen = useLiveChanges("ledger-1");
    useQuery({
      queryKey: ["accounts", "ledger-1"],
      queryFn: () =>
        fetch("/api/v1/ledgers/ledger-1/accounts").then((r) => r.json()),
      staleTime: Number.POSITIVE_INFINITY,
    });
    return null;
  }
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    markers = ["a", "b"];
    let loads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (!url.endsWith("/changes")) {
          // The first load is quick; the reload after the marker moves takes a second.
          loads += 1;
          const delay = loads === 1 ? 0 : 1000;
          return new Promise<Response>((resolve) =>
            setTimeout(() => resolve(respond(url)), delay),
          );
        }
        return Promise.resolve(respond(url));
      }),
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

  it("says updating until the data on screen has reloaded, then synced", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(seen).toBe("synced");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(liveChangesInterval);
    });
    expect(seen).toBe("updating");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(seen).toBe("synced");
  });
});
