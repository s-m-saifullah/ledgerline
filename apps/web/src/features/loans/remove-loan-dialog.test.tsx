import { type LoanBalance, newId } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T12:00:00"));
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  queryClient?.clear();
  vi.unstubAllGlobals();
});
function mount(dates: string[], hold: Promise<void> = Promise.resolve()) {
  const writes: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (target: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        await hold;
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
      await screen.findByRole("button", { name: "Delete" }),
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
    expect(list).toHaveTextContent("Oct 7");
    expect(list).toHaveTextContent("Oct 9");
    expect(list).not.toHaveTextContent("2026-");
    expect(list).not.toHaveTextContent("$");
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(writes).toHaveLength(0);
  });
  it("asks in a question named for the currency, with Cancel to keep it", async () => {
    mount([]);
    const question = await screen.findByRole("dialog", {
      name: "Delete the USD loan?",
    });
    expect(question.className).toContain("ui-question");
    expect(
      await screen.findByText(
        "Deletes the balance with Sam, including the one from before Ledgerline. No account changes.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });
  it("says Deleting… on the confirming button while the deletion is on its way", async () => {
    let release = () => {};
    mount(
      [],
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const confirm = await screen.findByRole("button", { name: "Delete" });
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);
    expect(
      await screen.findByRole("button", { name: "Deleting…" }),
    ).toBeDisabled();
    release();
  });
  it("waits for the check before it allows the removal", async () => {
    mount([]);
    expect(await screen.findByText("Loading this loan…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled(),
    );
  });
  it("says the loan cannot be deleted yet, and Close is the only button", async () => {
    mount(["2026-10-07"]);
    expect(
      await screen.findByRole("dialog", {
        name: "The USD loan cannot be deleted yet",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Entries still use it. Delete them in Transactions first. They are dated:",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });
  it("shows fifty dates at most and says there are more", async () => {
    mount(
      Array.from(
        { length: 51 },
        (_, i) => `2026-09-${String((i % 28) + 1).padStart(2, "0")}`,
      ),
    );
    const list = await screen.findByRole("list", {
      name: "Entries using this loan",
    });
    expect(within(list).getAllByRole("listitem")).toHaveLength(50);
    expect(screen.getByText("and more.")).toBeTruthy();
  });
  it("retries an unconfirmed removal with the same key, and uses a new one after a refusal", async () => {
    const keys: (string | null)[] = [];
    const replies = [500, 409, 204];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_target: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          keys.push(new Headers(init.headers).get("Idempotency-Key"));
          const status = replies.shift() ?? 204;
          return status === 204
            ? new Response(null, { status })
            : new Response(
                JSON.stringify({
                  type: "x",
                  title: "x",
                  status,
                  detail: "Changed.",
                }),
                { status },
              );
        }
        return new Response(JSON.stringify({ items: [], nextCursor: null }));
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
    const button = async () => screen.findByRole("button", { name: "Delete" });
    await waitFor(async () => expect(await button()).toBeEnabled());
    await userEvent.click(await button());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't delete that. Please try again.",
    );
    await userEvent.click(await button());
    await screen.findByText("Changed.");
    await userEvent.click(await button());
    await waitFor(() => expect(removed).toHaveBeenCalled());
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });
});
