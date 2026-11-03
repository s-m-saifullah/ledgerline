import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  category,
  chooseCategory,
  json,
  ledgerId,
} from "../../test-support/category-fixtures";
import { CategoryEditor } from "./editor";

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
/** Open an icon or colour row and choose one of its options. */
async function pick(row: string, option: string) {
  await userEvent.click(
    screen.getByRole("button", { name: new RegExp(`^${row}`) }),
  );
  await userEvent.click(
    within(screen.getByRole("radiogroup", { name: row })).getByRole("radio", {
      name: option,
    }),
  );
}
it("validates names and saves a child with its chosen icon and color", async () => {
  const saved = vi.fn();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(json(category("Groceries", { parentId: root.id }), 201));
  vi.stubGlobal("fetch", fetchMock);
  render(<CategoryEditor {...props} onSaved={saved} />);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(
    await screen.findByText(/Give this category a name/),
  ).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText("Category name"), "Groceries");
  await chooseCategory("Parent category", root.name);
  await pick("Category icon", "Shopping");
  await pick("Category color", "Blue");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
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
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
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
  for (const radio of screen.getAllByRole("radio"))
    expect(radio).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This category changed",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Reload latest details" }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Category name")).toHaveValue("Latest"),
  );
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
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
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "already has this name",
  );
  expect(screen.getByLabelText("Category name")).toBeEnabled();
  await userEvent.type(screen.getByLabelText("Category name"), " new");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
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

it("clears the parent when the kind changes", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>());
  render(<CategoryEditor {...props} />);
  await chooseCategory("Parent category", root.name);
  expect(screen.getByLabelText("Parent category", { exact: true })).toHaveValue(
    root.name,
  );
  await userEvent.click(screen.getByRole("radio", { name: "Income" }));
  expect(screen.queryByDisplayValue(root.name)).toBeNull();
});
it("does not offer a parent to a category that has subcategories, and says why", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>());
  const child = category("Groceries", { parentId: root.id });
  render(
    <CategoryEditor {...props} category={root} categories={[root, child]} />,
  );
  expect(
    screen.getByLabelText("Parent category", { exact: true }),
  ).toBeDisabled();
  expect(screen.getByText(/Move this category's children/)).toBeTruthy();
});

it("sends no parent after the kind changes under a chosen one", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(json(category("Pay", { kind: "income" }), 201));
  vi.stubGlobal("fetch", fetchMock);
  render(<CategoryEditor {...props} />);
  await chooseCategory("Parent category", root.name);
  await userEvent.click(screen.getByRole("radio", { name: "Income" }));
  await userEvent.type(screen.getByLabelText("Category name"), "Pay");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
    kind: "income",
    parentId: null,
  });
});

it("draws every icon and colour beside its name, and the chosen one on the row", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>());
  render(<CategoryEditor {...props} />);
  const iconRow = screen.getByRole("button", { name: /^Category icon/ });
  expect(iconRow).toHaveTextContent("No icon");
  await userEvent.click(iconRow);
  const icons = within(
    screen.getByRole("radiogroup", { name: "Category icon" }),
  );
  const options = icons.getAllByRole("radio");
  expect(options).toHaveLength(19);
  for (const option of options)
    expect(option.querySelector("svg")).not.toBeNull();
  await userEvent.click(icons.getByRole("radio", { name: "Coffee" }));
  expect(
    screen.queryByRole("radiogroup", { name: "Category icon" }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: /^Category icon/ }),
  ).toHaveTextContent("Coffee");
  expect(
    screen.getByRole("button", { name: /^Category icon/ }).querySelector("svg"),
  ).not.toBeNull();
  const colorRow = screen.getByRole("button", { name: /^Category color/ });
  await userEvent.click(colorRow);
  const colors = within(
    screen.getByRole("radiogroup", { name: "Category color" }),
  );
  const swatches = colors.getAllByRole("radio");
  expect(swatches).toHaveLength(9);
  const blue = colors.getByRole("radio", { name: "Blue" });
  expect(
    blue.querySelector<HTMLElement>(".cg-swatch")?.style.backgroundColor,
  ).toBe("rgb(37, 99, 235)");
  expect(
    colors
      .getByRole("radio", { name: "No color" })
      .querySelector(".cg-swatch")
      ?.getAttribute("data-empty"),
  ).toBe("true");
  await userEvent.click(blue);
  const row = screen.getByRole("button", { name: /^Category color/ });
  expect(row).toHaveTextContent("Blue");
  expect(
    row.querySelector<HTMLElement>(".cg-swatch")?.style.backgroundColor,
  ).toBe("rgb(37, 99, 235)");
});
it("keeps an icon or colour the list does not know, and shows it as current", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>());
  const odd = category("Odd", { icon: "mystery", color: "#123456" });
  render(<CategoryEditor {...props} category={odd} categories={[odd]} />);
  expect(
    screen.getByRole("button", { name: /^Category icon/ }),
  ).toHaveTextContent("Current icon (mystery)");
  expect(
    screen.getByRole("button", { name: /^Category color/ }),
  ).toHaveTextContent("Current color (#123456)");
});
it("marks the chosen option and shows the list only while the row is open", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>());
  render(<CategoryEditor {...props} />);
  const row = screen.getByRole("button", { name: /^Category color/ });
  expect(row).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(row);
  expect(row).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("radio", { name: "No color" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Teal" })).not.toBeChecked();
  await userEvent.click(row);
  expect(
    screen.queryByRole("radiogroup", { name: "Category color" }),
  ).toBeNull();
});
