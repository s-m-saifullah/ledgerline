import { focusManager, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient, prefetchStartup } from "./query-client";
import { queryKeys } from "./query-keys";

afterEach(() => {
  vi.unstubAllGlobals();
  focusManager.setFocused(undefined);
});

describe("createQueryClient", () => {
  it("does not reload stale answers when the window gets focus: only the change marker asks then", async () => {
    const client = createQueryClient();
    // The provider mounts the client in the app; it is what listens for the window's focus.
    client.mount();
    let loads = 0;
    const watching = new QueryObserver(client, {
      queryKey: ["x"],
      queryFn: () => ++loads,
      staleTime: 0,
    });
    const stop = watching.subscribe(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loads).toBe(1);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loads).toBe(1);
    stop();
    client.unmount();
  });

  it("does not retry and keeps answers for 30 seconds", () => {
    const defaults = createQueryClient().getDefaultOptions().queries;
    expect(defaults?.retry).toBe(false);
    expect(defaults?.staleTime).toBe(30_000);
  });
});

describe("prefetchStartup", () => {
  it("asks for the ledgers at once, beside the session", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response(JSON.stringify({ items: [] }));
      }),
    );
    const client = createQueryClient();
    await prefetchStartup(client);
    expect(requests).toEqual(["/api/v1/ledgers"]);
    expect(client.getQueryData(queryKeys.ledgers)).toEqual({ items: [] });
  });

  it("stays quiet when nobody is signed in yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    const client = createQueryClient();
    await expect(prefetchStartup(client)).resolves.toBeUndefined();
    expect(client.getQueryData(queryKeys.ledgers)).toBeUndefined();
  });
});
