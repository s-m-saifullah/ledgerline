import { newId } from "@ledgerline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getActiveAccounts, getAllAccounts, pickableAccounts } from "./api";

const ledgerId = newId();
const account = (name: string, contactId: string | null = null) => ({
  id: newId(),
  ledgerId,
  name,
  type: "bank",
  currency: "USD",
  openingBalance: { amount: 0, currency: "USD" },
  inboundBonusBps: null,
  bonusCategoryId: null,
  feeCategoryId: null,
  defaultFee: null,
  contactId,
  balance: { amount: 0, currency: "USD" },
  archivedAt: null,
  version: 1,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
});
afterEach(() => vi.unstubAllGlobals());

describe("getActiveAccounts", () => {
  it("reads active accounts page by page until there is no next page, and passes the abort signal on", async () => {
    const second = newId();
    const fetcher = vi.fn<typeof fetch>(
      async (url) =>
        new Response(
          JSON.stringify(
            String(url).includes("cursor=")
              ? { items: [account("C")], nextCursor: null }
              : { items: [account("A"), account("B")], nextCursor: second },
          ),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    const found = await getActiveAccounts(ledgerId, controller.signal);
    expect(found.map((a) => a.name)).toEqual(["A", "B", "C"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("status=active");
    expect(String(fetcher.mock.calls[1]?.[0])).toContain(`cursor=${second}`);
    expect(fetcher.mock.calls[1]?.[1]?.signal).toBe(controller.signal);
  });

  it("keeps a client's balance account: Home lists it, and the picking screens filter it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [account("Bank"), account("Client", newId())],
              nextCursor: null,
            }),
          ),
      ),
    );
    const found = await getActiveAccounts(ledgerId);
    expect(found.map((a) => a.name)).toEqual(["Bank", "Client"]);
    expect(pickableAccounts(found).map((a) => a.name)).toEqual(["Bank"]);
  });

  it("rejects a non-advancing cursor instead of hanging setup", async () => {
    const cursor = newId();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ items: [account("A")], nextCursor: cursor }),
          ),
      ),
    );
    await expect(getActiveAccounts(ledgerId)).rejects.toThrow(
      "Account pagination did not advance",
    );
  });
});

describe("getAllAccounts", () => {
  it("asks for every status", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ items: [account("A")], nextCursor: null }),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    await getAllAccounts(ledgerId);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("status=all");
  });
});
