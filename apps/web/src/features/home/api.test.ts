import { newId } from "@ledgerline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getActiveAccounts } from "./api";

const ledgerId = newId();
function account(name: string) {
  return {
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
    contactId: null,
    balance: { amount: 0, currency: "USD" },
    archivedAt: null,
    version: 1,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}
afterEach(() => vi.unstubAllGlobals());

describe("getActiveAccounts", () => {
  it("reads active accounts page by page until there is no next page", async () => {
    const second = newId();
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(String(url));
        return new Response(
          JSON.stringify(
            String(url).includes("cursor=")
              ? { items: [account("C")], nextCursor: null }
              : { items: [account("A"), account("B")], nextCursor: second },
          ),
        );
      }),
    );
    const found = await getActiveAccounts(ledgerId);
    expect(found.map((a) => a.name)).toEqual(["A", "B", "C"]);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("status=active");
    expect(urls[1]).toContain(`cursor=${second}`);
  });

  it("stops after ten pages even if the server keeps sending a next page", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ items: [account("A")], nextCursor: newId() }),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await getActiveAccounts(ledgerId)).toHaveLength(10);
    expect(fetcher).toHaveBeenCalledTimes(10);
  });
});
