import { newId, type Tag } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { TagSheet } from "./tag-sheet";

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
const ledgerId = newId();
const tag = (name: string, over: Partial<Tag> = {}): Tag => ({
  id: newId(),
  ledgerId,
  name,
  archivedAt: null,
  usageCount: 0,
  version: 3,
  createdAt: "2026-10-05T00:00:00.000Z",
  updatedAt: "2026-10-05T00:00:00.000Z",
  ...over,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
type Write = { url: string; method: string; body: unknown; key: string };
function mount(
  subject: Tag | undefined,
  reply: (init: RequestInit) => Response | Promise<Response> = () =>
    new Response(JSON.stringify(subject ?? tag("New")), { status: 200 }),
) {
  const writes: Write[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url, init) => {
      const headers = new Headers(init?.headers);
      writes.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
        key: headers.get("Idempotency-Key") ?? "",
      });
      return reply(init ?? {});
    }),
  );
  const onSaved = vi.fn();
  const onDismiss = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TagSheet
        ledgerId={ledgerId}
        tag={subject}
        onDismiss={onDismiss}
        onSaved={onSaved}
      />
    </QueryClientProvider>,
  );
  return { writes, onSaved, onDismiss };
}
const problem = (status: number, detail: string) =>
  new Response(
    JSON.stringify({ type: "about:blank", title: "Problem", status, detail }),
    {
      status,
      headers: { "Content-Type": "application/problem+json" },
    },
  );

it("opens an existing tag on its actions: view, rename, archive and delete in red", async () => {
  mount(tag("Trip", { usageCount: 2 }));
  const sheet = await screen.findByRole("dialog", { name: "Trip" });
  expect(sheet).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View entries" })).toHaveAttribute(
    "href",
    expect.stringContaining("/transactions?tagId="),
  );
  for (const name of ["Rename", "Archive", "Delete"])
    expect(screen.getByRole("button", { name })).toBeInTheDocument();
  expect(screen.getByText("Delete")).toHaveClass("tg-danger");
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});
it("offers Unarchive for an archived tag", async () => {
  mount(tag("Old", { archivedAt: "2026-10-06T00:00:00.000Z" }));
  expect(
    await screen.findByRole("button", { name: "Unarchive" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
});
it("archives with the tag's version and says it stays on its entries", async () => {
  const { writes, onSaved } = mount(tag("Trip"));
  await userEvent.click(await screen.findByRole("button", { name: "Archive" }));
  expect(writes[0]).toMatchObject({
    method: "POST",
    body: { expectedVersion: 3 },
  });
  expect(writes[0]?.url).toContain("/archive");
  expect(onSaved).toHaveBeenCalledWith(
    "Archived Trip. It stays on its entries.",
  );
});
it("unarchives and says so", async () => {
  const { writes, onSaved } = mount(
    tag("Old", { archivedAt: "2026-10-06T00:00:00.000Z" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Unarchive" }),
  );
  expect(writes[0]?.url).toContain("/unarchive");
  expect(onSaved).toHaveBeenCalledWith("Unarchived Old.");
});
it("renames in the same sheet: the name is prefilled and Save sends the version", async () => {
  const { writes, onSaved } = mount(tag("Trip"));
  await userEvent.click(await screen.findByRole("button", { name: "Rename" }));
  expect(
    screen.getByRole("dialog", { name: "Rename tag" }),
  ).toBeInTheDocument();
  const box = screen.getByLabelText("Name");
  expect(box).toHaveFocus();
  expect(box).toHaveValue("Trip");
  await userEvent.clear(box);
  await userEvent.type(box, "Holiday");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(writes[0]).toMatchObject({
    method: "PATCH",
    body: { name: "Holiday", expectedVersion: 3 },
  });
  expect(onSaved).toHaveBeenCalledWith("Renamed to Holiday.");
});
it("adds a tag: an empty sheet with a Name field and Save", async () => {
  const { writes, onSaved } = mount(undefined);
  expect(
    await screen.findByRole("dialog", { name: "Add tag" }),
  ).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Name"), "Trip");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(writes[0]).toMatchObject({ method: "POST", body: { name: "Trip" } });
  expect(onSaved).toHaveBeenCalledWith("Added the tag Trip.");
});
it("refuses a name with a comma, and an empty one, with the rule", async () => {
  const { writes } = mount(undefined);
  await userEvent.type(await screen.findByLabelText("Name"), "a,b");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Use 1 to 40 characters, without commas or semicolons, for a tag name.",
  );
  await userEvent.clear(screen.getByLabelText("Name"));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(writes).toHaveLength(0);
});
it("shows the server's words for a duplicate and keeps the sheet open", async () => {
  const { onSaved } = mount(undefined, () =>
    problem(409, "A tag with this name already exists."),
  );
  await userEvent.type(await screen.findByLabelText("Name"), "Trip");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "A tag with this name already exists.",
  );
  expect(onSaved).not.toHaveBeenCalled();
});
it("repeats a save with the same key when the answer was lost, and takes a new one for a new name", async () => {
  let calls = 0;
  const { writes } = mount(undefined, () => {
    calls += 1;
    return calls === 1
      ? problem(503, "Down")
      : new Response(JSON.stringify(tag("Trip")), { status: 200 });
  });
  await userEvent.type(await screen.findByLabelText("Name"), "Trip");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("alert");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(writes).toHaveLength(2);
  expect(writes[1]?.key).toBe(writes[0]?.key);
  expect(writes[0]?.key).not.toBe("");
});
it("asks before deleting, keeps the sheet under the question and refuses a tag that entries use", async () => {
  const { writes, onSaved } = mount(
    tag("Spare"),
    () => new Response(null, { status: 204 }),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
  const question = await screen.findByRole("dialog", { name: "Delete Spare?" });
  expect(question).toHaveTextContent(
    "No entry has it. This can't be undone, but you can add the tag again any time.",
  );
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: "Delete Spare?" })).toBeNull();
  expect(screen.getByRole("dialog", { name: "Spare" })).toBeInTheDocument();
  expect(writes).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Delete tag" }),
  );
  expect(writes[0]).toMatchObject({
    method: "DELETE",
    body: { expectedVersion: 3 },
  });
  expect(onSaved).toHaveBeenCalledWith("Deleted the tag Spare.");
});
it("cannot delete a tag that entries use: the question says why and Delete tag is off", async () => {
  const { writes } = mount(tag("Trip", { usageCount: 1 }));
  await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
  const question = await screen.findByRole("dialog", { name: "Delete Trip?" });
  expect(question).toHaveTextContent(
    "1 entry has this tag, so it can't be deleted. Archive it to hide it instead.",
  );
  expect(screen.getByRole("button", { name: "Delete tag" })).toBeDisabled();
  expect(writes).toHaveLength(0);
});
it("says how many entries when several use the tag", async () => {
  mount(tag("Trip", { usageCount: 4 }));
  await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
  expect(
    await screen.findByRole("dialog", { name: "Delete Trip?" }),
  ).toHaveTextContent("4 entries have this tag, so it can't be deleted.");
});
it("shows a failed delete inside the question", async () => {
  mount(tag("Spare"), () =>
    problem(409, "This tag changed. Reload and try again."),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Delete tag" }),
  );
  expect(
    await screen.findByText("This tag changed. Reload and try again."),
  ).toBeInTheDocument();
});
it("takes a new key after a refusal, and for a different name after a lost answer", async () => {
  let calls = 0;
  const { writes } = mount(undefined, () => {
    calls += 1;
    return calls === 1
      ? problem(409, "A tag with this name already exists.")
      : calls === 2
        ? problem(503, "Down")
        : new Response(JSON.stringify(tag("Trips")), { status: 200 });
  });
  await userEvent.type(await screen.findByLabelText("Name"), "Trip");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("alert");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(writes).toHaveLength(2));
  // The refusal was final, so the second try is a new action with its own key.
  expect(writes[1]?.key).not.toBe(writes[0]?.key);
  await screen.findByText("We couldn't confirm that. Please try again.");
  await userEvent.type(screen.getByLabelText("Name"), "s");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(writes).toHaveLength(3));
  expect(writes[2]?.body).toEqual({ name: "Trips" });
  expect(writes[2]?.key).not.toBe(writes[1]?.key);
});
it("uses its own words when the network fails before an answer", async () => {
  const { onSaved } = mount(undefined, () => {
    throw new TypeError("network down");
  });
  await userEvent.type(await screen.findByLabelText("Name"), "Trip");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't add the tag.",
  );
  expect(onSaved).not.toHaveBeenCalled();
});
it("uses its own words for a failed archive, rename and delete when no answer came", async () => {
  mount(tag("Trip"), () => {
    throw new TypeError("network down");
  });
  await userEvent.click(await screen.findByRole("button", { name: "Archive" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't change the tag.",
  );
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Delete tag" }),
  );
  expect(
    await screen.findAllByText("Couldn't delete the tag."),
  ).not.toHaveLength(0);
});
it("treats a 500 as an unknown answer and repeats it with the same key", async () => {
  let calls = 0;
  const { writes } = mount(undefined, () => {
    calls += 1;
    return calls === 1
      ? problem(500, "Broke")
      : new Response(JSON.stringify(tag("Trip")), { status: 200 });
  });
  await userEvent.type(await screen.findByLabelText("Name"), "Trip");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("We couldn't confirm that. Please try again.");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]?.key).toBe(writes[0]?.key);
});
it("forgets a failed delete's words when the question is closed and asked again", async () => {
  mount(tag("Spare"), () =>
    problem(409, "This tag changed. Reload and try again."),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Delete tag" }),
  );
  await screen.findByText("This tag changed. Reload and try again.");
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  // Back on the sheet, the question's failure is not left standing under it.
  expect(screen.queryByRole("alert")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  await screen.findByRole("dialog", { name: "Delete Spare?" });
  expect(
    screen.queryByText("This tag changed. Reload and try again."),
  ).toBeNull();
});
