import { newId } from "@ledgerline/shared";
import { afterEach, expect, it, vi } from "vitest";
import { prepareTransactionEdit } from "./api";

const ledgerId = newId();
afterEach(() => vi.unstubAllGlobals());
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
