import { newId } from "@ledgerline/shared";
import { afterEach, expect, it, vi } from "vitest";
import { getActiveAccounts, prepareTransactionEdit } from "./api";

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
it("always sends the tag list on an edit so removing the last tag clears it", async () => {
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({}), { status: 500 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const row = {
    id: newId(),
    version: 3,
    isSplit: false,
  } as unknown as import("@ledgerline/shared").Transaction;
  const body = {
    accountId: newId(),
    categoryId: newId(),
    kind: "expense",
    date: "2026-10-05",
    amount: { amount: -100, currency: "USD" },
    status: "cleared",
    payee: null,
    note: null,
  } as unknown as import("@ledgerline/shared").CreateTransaction;
  await prepareTransactionEdit(ledgerId, row, body)().catch(() => undefined);
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
    tagIds: [],
    expectedVersion: 3,
  });
});
