import { type Account, newId } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useActiveAccounts, useAllAccounts } from "./use-accounts";

const ledgerId = newId();
const row = (name: string, over: Partial<Account> = {}): Account => ({
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
  ...over,
});
const checking = row("Checking");
const clientBalance = row("Client balance", { contactId: newId() });
const old = row("Old", { archivedAt: "2026-10-02T00:00:00.000Z" });

let requests: string[];
beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      const all = url.includes("status=all");
      return new Response(
        JSON.stringify({
          items: all
            ? [checking, clientBalance, old]
            : [checking, clientBalance],
          nextCursor: null,
        }),
      );
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Names({ ownOnly, label }: { ownOnly: boolean; label: string }) {
  const accounts = useActiveAccounts(ledgerId, { ownOnly });
  return (
    <p data-testid={label}>
      {accounts.data?.map((account) => account.name).join(", ") ?? "loading"}
    </p>
  );
}

describe("useActiveAccounts", () => {
  it("is one request for every screen that wants the active accounts", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    });
    render(
      <QueryClientProvider client={client}>
        <Names ownOnly={false} label="home" />
        <Names ownOnly label="add" />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("home").textContent).not.toBe("loading"),
    );
    expect(requests).toHaveLength(1);
  });

  it("gives Home every active account and the Add sheet only the ones a person picks", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <Names ownOnly={false} label="home" />
        <Names ownOnly label="add" />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("home").textContent).toBe(
        "Checking, Client balance",
      ),
    );
    expect(screen.getByTestId("add").textContent).toBe("Checking");
  });

  it("does not ask while there is no ledger yet", () => {
    function Waiting() {
      useActiveAccounts(undefined);
      return null;
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Waiting />
      </QueryClientProvider>,
    );
    expect(requests).toEqual([]);
  });
});

describe("useAllAccounts", () => {
  it("lists the archived accounts too, under its own entry", async () => {
    function All() {
      const accounts = useAllAccounts(ledgerId);
      return <p data-testid="all">{accounts.data?.length ?? "loading"}</p>;
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <All />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("all").textContent).toBe("3"),
    );
    expect(requests[0]).toContain("status=all");
  });
});
