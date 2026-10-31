import type { Category } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { category, json, ledgerId } from "../../test-support/category-fixtures";
import { useCategoryCreate } from "./use-category-create";

afterEach(() => vi.unstubAllGlobals());

it("puts the new category in the list at once and asks the page and Home to refresh", async () => {
  const coffee = category("Coffee");
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => json(coffee, 201)),
  );
  const client = new QueryClient();
  const refresh = vi.spyOn(client, "invalidateQueries");
  client.setQueryData<Category[]>(["categories", ledgerId], []);
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
  expect(client.getQueryData(["categories", ledgerId])).toEqual([coffee]);
  expect(refresh).toHaveBeenCalledWith({ queryKey: ["categories", ledgerId] });
  expect(refresh).toHaveBeenCalledWith({ queryKey: ["home", ledgerId] });
});
