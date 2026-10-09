import { type Account, newId } from "@ledgerline/shared";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ArchiveAccountDialog } from "./archive";

const account: Account = {
  id: newId(),
  ledgerId: newId(),
  name: "My card",
  type: "card",
  currency: "USD",
  openingBalance: { amount: -98765, currency: "USD" },
  balance: { amount: -98765, currency: "USD" },
  archivedAt: null,
  version: 1,
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("retries an unconfirmed archive with the original key and version", async () => {
  const archived = { ...account, archivedAt: account.updatedAt, version: 2 };
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError("Connection lost"))
    .mockResolvedValueOnce(json(archived));
  vi.stubGlobal("fetch", fetchMock);
  const saved = vi.fn();
  render(
    <ArchiveAccountDialog
      ledgerId={account.ledgerId}
      account={account}
      open
      onDismiss={vi.fn()}
      onUnconfirmed={vi.fn()}
      onSaved={saved}
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Archive account" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Retry archive" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledWith(archived));
  const [first, retry] = fetchMock.mock.calls.map((call) => call[1]);
  expect(retry?.body).toBe(first?.body);
  expect(new Headers(retry?.headers).get("Idempotency-Key")).toBe(
    new Headers(first?.headers).get("Idempotency-Key"),
  );
});

it("clears an unconfirmed archive on a definitive conflict and reloads before a new intent", async () => {
  const latest = { ...account, name: "Updated card", version: 2 };
  const archived = { ...latest, archivedAt: account.updatedAt, version: 3 };
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError("Connection lost"))
    .mockResolvedValueOnce(
      json({ status: 409, detail: "This account changed." }, 409),
    )
    .mockResolvedValueOnce(json(latest))
    .mockResolvedValueOnce(json(archived));
  vi.stubGlobal("fetch", fetchMock);
  const unconfirmed = vi.fn();
  const saved = vi.fn();
  render(
    <ArchiveAccountDialog
      ledgerId={account.ledgerId}
      account={account}
      open
      onDismiss={vi.fn()}
      onUnconfirmed={unconfirmed}
      onSaved={saved}
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Archive account" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Retry archive" }),
  );
  const reload = await screen.findByRole("button", {
    name: "Reload latest details",
  });
  expect(unconfirmed).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole("button", { name: "Keep account" })).toBeEnabled();
  await userEvent.click(reload);
  await userEvent.click(
    await screen.findByRole("button", { name: "Archive account" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledWith(archived));
  expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({
    expectedVersion: 2,
  });
  expect(
    new Headers(fetchMock.mock.calls[3]?.[1]?.headers).get("Idempotency-Key"),
  ).not.toBe(
    new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Idempotency-Key"),
  );
});

it("retains deletion intent across interrupted response and close/resume", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError("Interrupted"))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  const saved = vi.fn();
  function Host() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Resume
        </button>
        <ArchiveAccountDialog
          mode="delete"
          ledgerId={account.ledgerId}
          account={account}
          open={open}
          onDismiss={() => setOpen(false)}
          onUnconfirmed={vi.fn()}
          onSaved={saved}
        />
      </>
    );
  }
  render(<Host />);
  await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
  await screen.findByRole("button", { name: "Retry delete" });
  await userEvent.click(screen.getByRole("button", { name: "Close for now" }));
  await userEvent.click(screen.getByRole("button", { name: "Resume" }));
  await userEvent.click(screen.getByRole("button", { name: "Retry delete" }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith(account));
  const [first, retry] = fetchMock.mock.calls.map((call) => call[1]);
  expect(retry?.method).toBe("DELETE");
  expect(retry?.body).toBe(first?.body);
  expect(new Headers(retry?.headers).get("Idempotency-Key")).toBe(
    new Headers(first?.headers).get("Idempotency-Key"),
  );
});
it("reloads a stale archived account before a fresh deletion", async () => {
  const latest = { ...account, version: 3, archivedAt: account.updatedAt };
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      json({ status: 409, detail: "This account changed." }, 409),
    )
    .mockResolvedValueOnce(json(latest))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  const saved = vi.fn();
  render(
    <ArchiveAccountDialog
      mode="delete"
      ledgerId={account.ledgerId}
      account={account}
      open
      onDismiss={vi.fn()}
      onUnconfirmed={vi.fn()}
      onSaved={saved}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Reload latest details" }),
  );
  expect(saved).not.toHaveBeenCalled();
  await userEvent.click(
    await screen.findByRole("button", { name: "Delete account" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledWith(latest));
  expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
    expectedVersion: 3,
  });
  expect(
    new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get("Idempotency-Key"),
  ).not.toBe(
    new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Idempotency-Key"),
  );
});

it("retries an unconfirmed unarchive with the original key and version", async () => {
  const archived = { ...account, archivedAt: account.updatedAt, version: 2 };
  const restored = { ...account, archivedAt: null, version: 3 };
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError("Connection lost"))
    .mockResolvedValueOnce(json(restored));
  vi.stubGlobal("fetch", fetchMock);
  const saved = vi.fn();
  render(
    <ArchiveAccountDialog
      mode="unarchive"
      ledgerId={account.ledgerId}
      account={archived}
      open
      onDismiss={vi.fn()}
      onUnconfirmed={vi.fn()}
      onSaved={saved}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Unarchive account?" }),
  ).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Unarchive account" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Retry unarchive" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledWith(restored));
  const [first, retry] = fetchMock.mock.calls;
  expect(String(first?.[0])).toContain(`/${account.id}/unarchive`);
  expect(JSON.parse(String(first?.[1]?.body))).toEqual({ expectedVersion: 2 });
  expect(retry?.[1]?.body).toBe(first?.[1]?.body);
  expect(new Headers(retry?.[1]?.headers).get("Idempotency-Key")).toBe(
    new Headers(first?.[1]?.headers).get("Idempotency-Key"),
  );
});
