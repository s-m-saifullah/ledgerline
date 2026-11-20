import { type Account, newId } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../../lib/query-keys";
import { category, ledgerId } from "../../test-support/category-fixtures";
import { QuickAdd } from "./quick-add";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

const bank: Account = {
  id: newId(),
  ledgerId,
  name: "Bank",
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
  createdAt: "2026-10-07T00:00:00.000Z",
  updatedAt: "2026-10-07T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(seed: boolean) {
  // Every request hangs: a sheet that needs an answer from the server can only show "Opening transaction…".
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => undefined)),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  if (seed) {
    // What Home or the shell's prefetch has already put in the cache.
    client.setQueryData(queryKeys.activeAccounts(ledgerId), [bank]);
    client.setQueryData(queryKeys.categories(ledgerId), [category("Food")]);
  }
  render(
    <QueryClientProvider client={client}>
      <QuickAdd
        actorId={newId()}
        ledgerId={ledgerId}
        writable
        open
        onDismiss={() => undefined}
        returnFocusId="add-transaction"
      />
    </QueryClientProvider>,
  );
}

describe("the Add sheet", () => {
  it("opens at once, with no loading state, when Home or the shell has already loaded the accounts and categories", async () => {
    mount(true);
    expect(await screen.findByLabelText("Amount (USD)")).toBeTruthy();
    expect(screen.queryByText("Opening transaction…")).toBeNull();
  });

  it("still shows its loading state when nothing has been loaded", async () => {
    mount(false);
    expect(await screen.findByText("Opening transaction…")).toBeTruthy();
  });
});
