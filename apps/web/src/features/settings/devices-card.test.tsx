import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevicesCard } from "./devices-card";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const ids = {
  here: "01a16000-0000-7000-8000-000000000001",
  phone: "01a16000-0000-7000-8000-000000000002",
  old: "01a16000-0000-7000-8000-000000000003",
};
const device = (
  id: string,
  name: string,
  current = false,
  lastUsedAt = "2026-10-21T15:04:00.000Z",
) => ({
  id,
  current,
  device: name,
  createdAt: "2026-10-01T10:00:00.000Z",
  lastUsedAt,
  expiresAt: "2026-10-28T10:00:00.000Z",
});

/** A fake server that remembers who is signed in. */
function server(
  start = [
    device(ids.here, "Chrome on macOS", true),
    device(ids.phone, "Ledgerline Android app (Pixel 8)"),
    device(ids.old, "Safari on iOS"),
  ],
  options: { failListOnce?: boolean; failRemove?: number } = {},
) {
  let items = [...start];
  let listFailures = options.failListOnce ? 1 : 0;
  const calls: { method: string; path: string; body?: string | undefined }[] =
    [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace("/api/v1", "");
    const method = init?.method ?? "GET";
    calls.push({ method, path, body: init?.body as string | undefined });
    if (method === "GET" && path === "/sessions") {
      if (listFailures-- > 0)
        return json({ title: "x", status: 500, detail: "x" }, 500);
      return json({ items });
    }
    if (method === "DELETE" && options.failRemove)
      return json(
        {
          type: "about:blank",
          title: "Conflict",
          status: options.failRemove,
          detail: "That device is gone.",
          errors: [],
        },
        options.failRemove,
      );
    if (method === "DELETE" && path === "/sessions") {
      items = items.filter((item) => item.current);
      return new Response(null, { status: 204 });
    }
    if (method === "DELETE" && path.startsWith("/sessions/")) {
      items = items.filter((item) => item.id !== path.split("/")[2]);
      return new Response(null, { status: 204 });
    }
    return json({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}
const mount = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <DevicesCard />
    </QueryClientProvider>,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DevicesCard", () => {
  it("lists the devices, marks this one and offers sign out only for the others", async () => {
    server();
    mount();
    expect(await screen.findByText("Chrome on macOS")).toBeTruthy();
    expect(screen.getByText("Current device")).toBeTruthy();
    expect(screen.getByText("Ledgerline Android app (Pixel 8)")).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /^Sign out [A-Z]/ }),
    ).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Sign out Chrome on macOS" }),
    ).toBeNull();
    expect(screen.getAllByText(/^Last used /)).toHaveLength(3);
  });

  it("shows the ten most recent devices and keeps the older ones behind a disclosure", async () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      device(
        `01a16000-0000-7000-8000-0000000001${String(i).padStart(2, "0")}`,
        `Firefox on Linux ${i}`,
        i === 0,
        new Date(Date.UTC(2026, 9, 21, 12, 0) - i * 3_600_000).toISOString(),
      ),
    );
    server(many);
    mount();
    expect(await screen.findByText("Firefox on Linux 0")).toBeTruthy();
    const older = screen.getByText("Show 4 older devices").closest("details");
    expect(older?.querySelectorAll("li")).toHaveLength(4);
    expect(document.querySelectorAll(".device-list > li")).toHaveLength(14);
    expect(document.querySelectorAll(".device-older li")).toHaveLength(4);
  });

  it("says so when this is the only device", async () => {
    server([device(ids.here, "Chrome on macOS", true)]);
    mount();
    expect(
      await screen.findByText("This is the only device signed in."),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Sign out all other devices" }),
    ).toBeNull();
  });

  it("signs one device out and shows the list without it", async () => {
    const { calls } = server();
    mount();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Sign out Ledgerline Android app (Pixel 8)",
      }),
    );
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "Signed out Ledgerline Android app (Pixel 8).",
    );
    expect(screen.queryByText("Ledgerline Android app (Pixel 8)")).toBeNull();
    const removal = calls.find((call) => call.method === "DELETE");
    expect(removal?.path).toBe(`/sessions/${ids.phone}`);
    expect(removal?.body).toBe("{}");
  });

  it("asks once before signing every other device out, and can be cancelled", async () => {
    const { calls } = server();
    mount();
    await userEvent.click(
      await screen.findByRole("button", { name: "Sign out all other devices" }),
    );
    expect(screen.getByText(/Sign out all your other devices\?/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
    await userEvent.click(
      screen.getByRole("button", { name: "Sign out all other devices" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Sign out all" }));
    expect(
      await screen.findByText("Signed out your other devices."),
    ).toBeTruthy();
    expect(screen.getByText("This is the only device signed in.")).toBeTruthy();
    expect(calls.filter((call) => call.method === "DELETE")).toEqual([
      { method: "DELETE", path: "/sessions", body: "{}" },
    ]);
  });

  it("offers a retry when the list cannot load", async () => {
    server(undefined, { failListOnce: true });
    mount();
    expect(
      await screen.findByText("We couldn't load your devices."),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Chrome on macOS")).toBeTruthy();
  });

  it("shows the server's reason when signing a device out fails", async () => {
    server(undefined, { failRemove: 404 });
    mount();
    await userEvent.click(
      await screen.findByRole("button", { name: "Sign out Safari on iOS" }),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "That device is gone.",
    );
  });
});
