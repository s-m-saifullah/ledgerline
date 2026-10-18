import { type LoanBalance, newId } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoveLoanDialog } from "./remove-loan-dialog";

const ledgerId = newId();
const person = { id: newId(), name: "Sam" };
const loan: LoanBalance = {
  accountId: newId(),
  currency: "USD",
  openingBalance: { amount: 5000, currency: "USD" },
  balance: { amount: 5000, currency: "USD" },
  version: 4,
};
const stamp = "2026-10-01T00:00:00.000Z";
const entry = (date: string) => ({
  id: newId(),
  ledgerId,
  accountId: loan.accountId,
  categoryId: null,
  kind: "transfer",
  status: "cleared",
  amount: { amount: 100, currency: "USD" },
  baseAmount: { amount: 100, currency: "USD" },
  fxRate: "1",
  date,
  time: null,
  payee: null,
  note: null,
  transferId: newId(),
  relatedTransferId: null,
  feeTransferId: null,
  tipPaymentId: null,
  splits: [],
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
});
let queryClient: QueryClient;
afterEach(() => {
  cleanup();
  queryClient?.clear();
  vi.unstubAllGlobals();
});
function mount(dates: string[]) {
  const writes: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (target: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        writes.push({
          url: String(target),
          method: init.method,
          body: JSON.parse(String(init.body)),
        });
        return new Response(null, { status: 204 });
      }
      return new Response(
        JSON.stringify({ items: dates.map(entry), nextCursor: null }),
      );
    }),
  );
  const removed = vi.fn();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RemoveLoanDialog
        ledgerId={ledgerId}
        person={person}
        loan={loan}
        returnFocusId="main-content"
        onClose={() => {}}
        onRemoved={removed}
      />
    </QueryClientProvider>,
  );
  return { writes, removed };
}

describe("RemoveLoanDialog", () => {
  it("removes a loan that only has its starting balance, with its version", async () => {
    const { writes, removed } = mount([]);
    await userEvent.click(
      await screen.findByRole("button", { name: "Remove loan" }),
    );
    await waitFor(() => expect(removed).toHaveBeenCalled());
    expect(writes[0]?.method).toBe("DELETE");
    expect(writes[0]?.url).toContain(
      `/contacts/${person.id}/loans/${loan.accountId}`,
    );
    expect(writes[0]?.body).toEqual({ expectedVersion: 4 });
  });
  it("lists only the dates of entries still using the loan and offers no removal", async () => {
    const { writes } = mount(["2026-10-07", "2026-10-09"]);
    const list = await screen.findByRole("list", {
      name: "Entries using this loan",
    });
    expect(list).toHaveTextContent("2026-10-07");
    expect(list).toHaveTextContent("2026-10-09");
    expect(list).not.toHaveTextContent("$");
    expect(screen.queryByRole("button", { name: "Remove loan" })).toBeNull();
    expect(writes).toHaveLength(0);
  });
});
