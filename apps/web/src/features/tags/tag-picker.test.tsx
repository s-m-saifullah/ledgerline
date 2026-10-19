import { newId, type Tag } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { json, ledgerId } from "../../test-support/category-fixtures";
import { TagPicker } from "./tag-picker";

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
function Host({ start = [] as string[] }) {
  const [value, setValue] = useState<string[]>(start);
  return (
    <QueryClientProvider client={new QueryClient()}>
      <TagPicker ledgerId={ledgerId} value={value} onChange={setValue} />
      <output data-testid="value">{value.join(",")}</output>
    </QueryClientProvider>
  );
}
it("fetches nothing until the box is used, then offers the most used tags first", async () => {
  const rare = tag("Gift", { usageCount: 1 });
  const common = tag("Trip", { usageCount: 9 });
  const old = tag("Old", { archivedAt: "2026-10-06T00:00:00.000Z" });
  const fetchMock = vi.fn<typeof fetch>(async () =>
    json({ items: [rare, common, old], nextCursor: null }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<Host />);
  expect(fetchMock).not.toHaveBeenCalled();
  await userEvent.click(screen.getByLabelText("Tags"));
  const buttons = await screen.findAllByRole("button");
  expect(buttons.map((button) => button.textContent)).toEqual(["Trip", "Gift"]);
});
it("picks a tag, shows it as a chip and removes it again", async () => {
  const trip = tag("Trip");
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => json({ items: [trip], nextCursor: null })),
  );
  render(<Host />);
  await userEvent.click(screen.getByLabelText("Tags"));
  await userEvent.click(await screen.findByRole("button", { name: "Trip" }));
  expect(screen.getByTestId("value")).toHaveTextContent(trip.id);
  await userEvent.click(
    await screen.findByRole("button", { name: "Remove tag Trip" }),
  );
  expect(screen.getByTestId("value")).toBeEmptyDOMElement();
});
it("creates a new tag from typed text and Enter does not submit the form", async () => {
  const created = tag("Holiday");
  const submitted = vi.fn((event: { preventDefault: () => void }) =>
    event.preventDefault(),
  );
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) =>
    init?.method === "POST"
      ? json(created, 201)
      : json({ items: [], nextCursor: null }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <form onSubmit={submitted}>
      <Host />
    </form>,
  );
  const box = screen.getByLabelText("Tags");
  await userEvent.type(box, "Holiday{Enter}");
  await waitFor(() =>
    expect(screen.getByTestId("value")).toHaveTextContent(created.id),
  );
  expect(submitted).not.toHaveBeenCalled();
  const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
  expect(JSON.parse(String(post?.[1]?.body))).toEqual({ name: "Holiday" });
});
it("refuses a name with a comma without calling the server", async () => {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    json({ items: [], nextCursor: null }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<Host />);
  await userEvent.type(screen.getByLabelText("Tags"), "a,b{Enter}");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "without commas or semicolons",
  );
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
    false,
  );
});
