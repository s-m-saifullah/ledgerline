import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { CategoryEditor } from "./editor";
import {
  category,
  chooseCategory,
  json,
  ledgerId,
} from "./fixtures.test-helper";

const root = category("Food");
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const props = {
  ledgerId,
  categories: [root],
  kind: "expense" as const,
  open: true,
  onDismiss: vi.fn(),
  onUnconfirmed: vi.fn(),
  onSaved: vi.fn(),
};
it("validates names and saves a child with its chosen icon and color", async () => {
  const saved = vi.fn();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(json(category("Groceries", { parentId: root.id }), 201));
  vi.stubGlobal("fetch", fetchMock);
  render(<CategoryEditor {...props} onSaved={saved} />);
  await userEvent.click(screen.getByRole("button", { name: "Add category" }));
  expect(
    await screen.findByText(/Give this category a name/),
  ).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText("Category name"), "Groceries");
  await chooseCategory("Parent category", root.name);
  await userEvent.selectOptions(
    screen.getByLabelText("Category icon"),
    "shopping-bag",
  );
  await userEvent.selectOptions(
    screen.getByLabelText("Category color"),
    "#2563EB",
  );
  await userEvent.click(screen.getByRole("button", { name: "Add category" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
    name: "Groceries",
    kind: "expense",
    parentId: root.id,
    icon: "shopping-bag",
    color: "#2563EB",
  });
});
it("keeps the same key and payload across an interrupted save and close/resume", async () => {
  const saved = vi.fn();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError("Interrupted"))
    .mockResolvedValue(json(root, 201));
  vi.stubGlobal("fetch", fetchMock);
  function Host() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Resume
        </button>
        <CategoryEditor
          {...props}
          open={open}
          onDismiss={() => setOpen(false)}
          onSaved={saved}
        />
      </>
    );
  }
  render(<Host />);
  await userEvent.type(screen.getByLabelText("Category name"), "Food");
  await userEvent.click(screen.getByRole("button", { name: "Add category" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "couldn't confirm the save",
  );
  expect(screen.getByLabelText("Category name")).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Close for now" }));
  await userEvent.click(screen.getByRole("button", { name: "Resume" }));
  await userEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
    fetchMock.mock.calls[0]?.[1]?.body,
  );
  expect(
    new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("Idempotency-Key"),
  ).toBe(
    new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Idempotency-Key"),
  );
});
it("reloads stale edits and uses the new version while leaving kind immutable", async () => {
  const latest = { ...root, name: "Latest", version: 2 };
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      json(
        {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          detail: "Reload.",
          errors: [{ field: "expectedVersion", message: "Reload." }],
        },
        409,
      ),
    )
    .mockImplementation(async (url) =>
      String(url).includes("?")
        ? json({ items: [latest], nextCursor: null })
        : json(latest),
    );
  vi.stubGlobal("fetch", fetchMock);
  const saved = vi.fn();
  render(<CategoryEditor {...props} category={root} onSaved={saved} />);
  expect(screen.getByLabelText("Category kind")).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This category changed",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Reload latest details" }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Category name")).toHaveValue("Latest"),
  );
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const writes = fetchMock.mock.calls.filter(
    (call) => call[1]?.method === "PATCH",
  );
  expect(JSON.parse(String(writes[1]?.[1]?.body))).toMatchObject({
    expectedVersion: 2,
  });
  expect(JSON.parse(String(writes[1]?.[1]?.body))).not.toHaveProperty("kind");
});
it("allows correcting duplicate names after a definitive conflict", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      json(
        {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          detail: "A sibling category already has this name.",
          errors: [{ field: "name", message: "Duplicate." }],
        },
        409,
      ),
    )
    .mockResolvedValue(json(root, 201));
  vi.stubGlobal("fetch", fetchMock);
  const saved = vi.fn();
  render(<CategoryEditor {...props} onSaved={saved} />);
  await userEvent.type(screen.getByLabelText("Category name"), "Food");
  await userEvent.click(screen.getByRole("button", { name: "Add category" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "already has this name",
  );
  expect(screen.getByLabelText("Category name")).toBeEnabled();
  await userEvent.type(screen.getByLabelText("Category name"), " new");
  await userEvent.click(screen.getByRole("button", { name: "Add category" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(
    new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("Idempotency-Key"),
  ).not.toBe(
    new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Idempotency-Key"),
  );
});
it("refreshes parent choices when the list finishes loading after the form opens", async () => {
  const view = render(<CategoryEditor {...props} categories={[]} />);
  await userEvent.type(screen.getByLabelText("Category name"), "New child");
  view.rerender(<CategoryEditor {...props} categories={[root]} />);
  await chooseCategory("Parent category", root.name);
  expect(screen.getByLabelText("Parent category")).toHaveValue(root.name);
  expect(screen.getByLabelText("Category name")).toHaveValue("New child");
});
