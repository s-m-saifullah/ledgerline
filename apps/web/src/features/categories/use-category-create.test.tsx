import type { Category } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { queryKeys } from "../../lib/query-keys";
import { category, json, ledgerId } from "../../test-support/category-fixtures";
import { useCategoryCreate } from "./use-category-create";

afterEach(() => vi.unstubAllGlobals());

it("puts the new category in the list at once and refreshes the ledger", async () => {
  const coffee = category("Coffee");
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => json(coffee, 201)),
  );
  const client = new QueryClient();
  const refresh = vi.spyOn(client, "invalidateQueries");
  client.setQueryData<Category[]>(queryKeys.categories(ledgerId), []);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useCategoryCreate(ledgerId, "expense"), {
    wrapper,
  });
  let id = "";
  await act(async () => {
    id = await result.current.create.run("Coffee");
  });
  expect(id).toBe(coffee.id);
  expect(client.getQueryData(queryKeys.categories(ledgerId))).toEqual([coffee]);
  // The whole ledger refreshes, so Home (its setup note) and every page reading categories follow.
  await waitFor(() =>
    expect(refresh).toHaveBeenCalledWith({
      queryKey: queryKeys.ledger(ledgerId),
    }),
  );
});
