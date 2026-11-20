import { newId } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { category } from "../test-support/category-fixtures";
import { useCategories } from "./use-categories";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useCategories", () => {
  it("is one request for every screen that wants the categories", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response(
          JSON.stringify({ items: [category("Food")], nextCursor: null }),
        );
      }),
    );
    const ledgerId = newId();
    function Count({ label }: { label: string }) {
      const categories = useCategories(ledgerId);
      return <p data-testid={label}>{categories.data?.length ?? "loading"}</p>;
    }
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { staleTime: 30_000 } },
          })
        }
      >
        <Count label="add" />
        <Count label="loan" />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("add").textContent).toBe("1"),
    );
    expect(screen.getByTestId("loan").textContent).toBe("1");
    expect(requests).toHaveLength(1);
  });

  it("does not ask when told not to, or while there is no ledger", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    function Idle() {
      useCategories(undefined);
      useCategories(newId(), false);
      return null;
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Idle />
      </QueryClientProvider>,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
