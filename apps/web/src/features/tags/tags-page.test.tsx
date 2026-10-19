import { newId, type Tag } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { json, ledgerId } from "../../test-support/category-fixtures";
import { TagsPage } from "./tags-page";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
const ledger = {
  id: ledgerId,
  name: "Personal",
  baseCurrency: "USD",
  timeZone: null,
  version: 1,
  role: "owner",
};
const tag = (name: string, over: Partial<Tag> = {}): Tag => ({
  id: newId(),
  ledgerId,
  name,
  archivedAt: null,
  usageCount: 0,
  version: 1,
  createdAt: "2026-10-05T00:00:00.000Z",
  updatedAt: "2026-10-05T00:00:00.000Z",
  ...over,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const mount = (items: Tag[], writes: unknown[] = []) => {
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).includes("/tags")) {
      if (init?.method && init.method !== "GET") {
        writes.push({ url: String(url), method: init.method, body: init.body });
        return init.method === "DELETE"
          ? new Response(null, { status: 204 })
          : json(items[0]);
      }
      return json({ items, nextCursor: null });
    }
    return json({ items: [ledger] });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TagsPage />
    </QueryClientProvider>,
  );
  return fetchMock;
};
it("lists active and archived tags with their use counts", async () => {
  mount([
    tag("Trip", { usageCount: 3 }),
    tag("Gift", { usageCount: 1 }),
    tag("Old", { archivedAt: "2026-10-06T00:00:00.000Z" }),
  ]);
  expect(await screen.findByText("3 entries")).toBeInTheDocument();
  expect(screen.getByText("1 entry")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Archived" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Unarchive" })).toBeInTheDocument();
});
it("keeps Delete disabled for a tag that entries use and deletes an unused one", async () => {
  const writes: { method: string; body: string }[] = [];
  const unused = tag("Spare");
  mount([tag("Trip", { usageCount: 2 }), unused], writes);
  await screen.findByText("2 entries");
  const deletes = screen.getAllByRole("button", { name: "Delete" });
  // Alphabetical: Spare first, Trip second.
  await userEvent.click(deletes[1] as HTMLElement);
  expect(
    await screen.findByRole("button", { name: "Delete tag" }),
  ).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await userEvent.click(deletes[0] as HTMLElement);
  await userEvent.click(
    await screen.findByRole("button", { name: "Delete tag" }),
  );
  await screen.findByText("Deleted the tag Spare.");
  expect(writes[0]).toMatchObject({ method: "DELETE" });
  expect(JSON.parse(writes[0]?.body as string)).toEqual({
    expectedVersion: 1,
  });
});
it("renames a tag with its version", async () => {
  const writes: { method: string; body: string }[] = [];
  mount([tag("Trip")], writes);
  await userEvent.click(await screen.findByRole("button", { name: "Rename" }));
  const box = await screen.findByLabelText("Name");
  await userEvent.clear(box);
  await userEvent.type(box, "Holiday");
  await userEvent.click(screen.getByRole("button", { name: "Save name" }));
  await screen.findByText("Renamed to Holiday.");
  expect(JSON.parse(writes[0]?.body as string)).toEqual({
    name: "Holiday",
    expectedVersion: 1,
  });
});
