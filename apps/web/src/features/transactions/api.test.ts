import { newId } from "@ledgerline/shared";
import { afterEach, expect, it, vi } from "vitest";
import { getActiveAccounts } from "./api";

const ledgerId = newId(),
  first = newId(),
  last = newId();
const account = (id: string) => ({
  id,
  ledgerId,
  name: "Synthetic account",
  type: "bank",
  currency: "USD",
  openingBalance: { amount: 0, currency: "USD" },
  balance: { amount: 0, currency: "USD" },
  archivedAt: null,
  version: 1,
  createdAt: "2026-10-07T00:00:00Z",
  updatedAt: "2026-10-07T00:00:00Z",
});
afterEach(() => vi.unstubAllGlobals());
it("loads every active account page before picking a remembered account", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ items: [account(first)], nextCursor: first }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ items: [account(last)], nextCursor: null }),
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  const controller = new AbortController();
  expect(
    (await getActiveAccounts(ledgerId, controller.signal)).map((row) => row.id),
  ).toEqual([first, last]);
  expect(String(fetchMock.mock.calls[0]?.[0])).toContain("status=active");
  expect(String(fetchMock.mock.calls[1]?.[0])).toContain(`cursor=${first}`);
  expect(fetchMock.mock.calls[1]?.[1]?.signal).toBe(controller.signal);
});
it("rejects a non-advancing account cursor instead of hanging entry setup", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ items: [account(first)], nextCursor: first }),
        ),
    ),
  );
  await expect(getActiveAccounts(ledgerId)).rejects.toThrow(
    "Account pagination did not advance",
  );
});
