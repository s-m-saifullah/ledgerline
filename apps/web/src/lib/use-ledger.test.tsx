import { newId } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLedger } from "./use-ledger";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ledger = (role: string) => ({
  id: newId(),
  name: "Personal",
  baseCurrency: "USD",
  timeZone: null,
  version: 1,
  role,
});

function Probe() {
  const { ledger: found, ledgerId, writable, ledgers } = useLedger();
  return (
    <p data-testid="probe">
      {ledgers.isPending
        ? "loading"
        : `${found?.name ?? "none"}|${ledgerId ?? "-"}|${writable}`}
    </p>
  );
}

function mount(items: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ items }))),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Probe />
    </QueryClientProvider>,
  );
}

describe("useLedger", () => {
  it("has no ledger id until the ledgers have come", () => {
    mount([ledger("owner")]);
    expect(screen.getByTestId("probe").textContent).toBe("loading");
  });

  it("is the first ledger, and writable for an owner", async () => {
    const mine = ledger("owner");
    mount([mine]);
    await waitFor(() =>
      expect(screen.getByTestId("probe").textContent).toBe(
        `Personal|${mine.id}|true`,
      ),
    );
  });

  it("is not writable for a viewer", async () => {
    mount([ledger("viewer")]);
    await waitFor(() =>
      expect(screen.getByTestId("probe").textContent).toMatch(/\|false$/),
    );
  });

  it("is writable for an editor", async () => {
    mount([ledger("editor")]);
    await waitFor(() =>
      expect(screen.getByTestId("probe").textContent).toMatch(/\|true$/),
    );
  });

  it("says there is no ledger when the person has none", async () => {
    mount([]);
    await waitFor(() =>
      expect(screen.getByTestId("probe").textContent).toBe("none|-|false"),
    );
  });
});
