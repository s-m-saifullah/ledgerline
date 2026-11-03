import { newId, type Tag } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { json, ledgerId } from "../../test-support/category-fixtures";
import { type PageAdd, PageAddProvider } from "../shell/page-add";
import { TagsPage } from "./tags-page";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    search?: Record<string, string>;
  }) => (
    <a href={`${to}?tagId=${search?.tagId ?? ""}`} {...rest}>
      {children}
    </a>
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
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
});
type Write = { url: string; method: string; body: string };
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
const mount = (
  items: Tag[],
  { role = "owner", failTags = false, adds = [] as (PageAdd | null)[] } = {},
) => {
  const writes: Write[] = [];
  fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).includes("/tags")) {
      if (failTags) return json({}, 500);
      if (init?.method && init.method !== "GET") {
        writes.push({
          url: String(url),
          method: init.method,
          body: String(init.body),
        });
        return init.method === "DELETE"
          ? new Response(null, { status: 204 })
          : json(items[0]);
      }
      return json({ items, nextCursor: null });
    }
    return json({ items: [{ ...ledger, role }] });
  });
  vi.stubGlobal("fetch", fetchMock);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PageAddProvider value={(add) => adds.push(add)}>
        <TagsPage />
      </PageAddProvider>
    </QueryClientProvider>,
  );
  return { writes, adds };
};
const rowOf = (name: string) =>
  screen.getByRole("button", { name: new RegExp(`^${name}`) });

it("lists the tags by name, each with how many entries use it, and no page subtitle", async () => {
  mount([tag("Trip", { usageCount: 3 }), tag("Gift", { usageCount: 1 })]);
  expect(await screen.findByText("3 entries")).toBeInTheDocument();
  expect(screen.getByText("1 entry")).toBeInTheDocument();
  const names = screen
    .getAllByRole("button", { name: /entr/ })
    .map((button) => button.textContent);
  expect(names[0]).toContain("Gift");
  expect(names[1]).toContain("Trip");
  expect(screen.queryByText(/Free-form labels/)).toBeNull();
  expect(screen.queryByText("YOUR LEDGER")).toBeNull();
});
it("keeps the archived tags in one fold with their count", async () => {
  mount([
    tag("Trip"),
    tag("Old", { archivedAt: "2026-10-06T00:00:00.000Z" }),
    tag("Older", { archivedAt: "2026-10-06T00:00:00.000Z" }),
  ]);
  const summary = await screen.findByText("2 archived");
  expect(summary.closest("details")).not.toHaveAttribute("open");
  expect(
    within(summary.closest("details") as HTMLElement).getByText("Old"),
  ).toBeInTheDocument();
});
it("shows no fold without archived tags", async () => {
  mount([tag("Trip")]);
  await screen.findByText("Trip");
  expect(screen.queryByText(/archived/)).toBeNull();
});
it("searches by part of a name and says when nothing matches", async () => {
  mount([tag("Holiday"), tag("Gift")]);
  await screen.findByText("Holiday");
  const box = screen.getByRole("searchbox", { name: "Search tags" });
  await userEvent.type(box, "gif");
  expect(screen.queryByText("Holiday")).toBeNull();
  expect(screen.getByText("Gift")).toBeInTheDocument();
  await userEvent.clear(box);
  await userEvent.type(box, "zzz");
  expect(screen.getByText("No tag matches.")).toBeInTheDocument();
});
it("shows the search even when there are no tags, with the empty sentence", async () => {
  mount([]);
  expect(await screen.findByText("No tags yet.")).toBeInTheDocument();
  expect(
    screen.getByRole("searchbox", { name: "Search tags" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("No tag matches.")).toBeNull();
});
it("says it could not load the tags and offers to try again", async () => {
  mount([], { failTags: true });
  expect(await screen.findByText("Couldn't load your tags.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
});
it("opens a tag's sheet from its row", async () => {
  mount([tag("Trip", { usageCount: 2 })]);
  await userEvent.click(await screen.findByRole("button", { name: /Trip/ }));
  expect(await screen.findByRole("dialog", { name: "Trip" })).toBeVisible();
});
it("adds a tag and says so in a notice, then lists it again", async () => {
  const { writes } = mount([tag("Trip")]);
  await screen.findByText("Trip");
  await userEvent.click(screen.getByRole("button", { name: "Add tag" }));
  await userEvent.type(await screen.findByLabelText("Name"), "Gift");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Added the tag Gift.")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(JSON.parse(writes[0]?.body as string)).toEqual({ name: "Gift" });
});
it("renames a tag with its version and shows the notice", async () => {
  const { writes } = mount([tag("Trip")]);
  await userEvent.click(await screen.findByRole("button", { name: /Trip/ }));
  await userEvent.click(await screen.findByRole("button", { name: "Rename" }));
  const box = screen.getByLabelText("Name");
  await userEvent.clear(box);
  await userEvent.type(box, "Holiday");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Renamed to Holiday.")).toBeInTheDocument();
  expect(JSON.parse(writes[0]?.body as string)).toEqual({
    name: "Holiday",
    expectedVersion: 1,
  });
});
it("deletes an unused tag after the question, and refuses one that entries use", async () => {
  const { writes } = mount([tag("Trip", { usageCount: 2 }), tag("Spare")]);
  await userEvent.click(await screen.findByRole("button", { name: /Trip/ }));
  await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
  expect(
    await screen.findByRole("button", { name: "Delete tag" }),
  ).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await userEvent.click(rowOf("Spare"));
  await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Delete tag" }),
  );
  expect(await screen.findByText("Deleted the tag Spare.")).toBeInTheDocument();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ method: "DELETE" });
});
it("gives a phone's one Add the label Add tag, and the head button does the same", async () => {
  const { adds } = mount([tag("Trip")]);
  await screen.findByText("Trip");
  const add = adds.at(-1);
  expect(add).toMatchObject({ label: "Add tag", disabled: false });
  add?.onClick();
  expect(
    await screen.findByRole("dialog", { name: "Add tag" }),
  ).toBeInTheDocument();
});
it("lets a viewer only read: no Add, rows are links to the entries", async () => {
  const { adds } = mount([tag("Trip", { usageCount: 2 })], { role: "viewer" });
  const link = await screen.findByRole("link", { name: /Trip/ });
  expect(link).toHaveAttribute("href", expect.stringContaining("tagId="));
  expect(screen.queryByRole("button", { name: "Add tag" })).toBeNull();
  expect(adds.at(-1) ?? null).toBeNull();
  await userEvent.click(link);
  expect(screen.queryByRole("dialog")).toBeNull();
});
const tagReads = () =>
  fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url).includes("/tags") && (init?.method ?? "GET") === "GET",
  ).length;
it("reads the tags again after a save, so the list shows the change", async () => {
  mount([tag("Trip")]);
  await screen.findByText("Trip");
  const before = tagReads();
  await userEvent.click(screen.getByRole("button", { name: "Add tag" }));
  await userEvent.type(await screen.findByLabelText("Name"), "Gift");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Added the tag Gift.");
  await vi.waitFor(() => expect(tagReads()).toBeGreaterThan(before));
});
it("clears the last notice when another sheet opens", async () => {
  mount([tag("Trip"), tag("Spare")]);
  await userEvent.click(await screen.findByRole("button", { name: "Add tag" }));
  await userEvent.type(await screen.findByLabelText("Name"), "Gift");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Added the tag Gift.");
  await userEvent.click(rowOf("Spare"));
  await screen.findByRole("dialog", { name: "Spare" });
  expect(screen.queryByText("Added the tag Gift.")).toBeNull();
});
