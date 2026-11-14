import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { category, json, ledgerId } from "../../test-support/category-fixtures";
import { type PageAdd, PageAddProvider } from "../shell/page-add";
import { CategoriesPage } from "./categories-page";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    className,
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
});
/** What the page last told the shell its one Add button does. */
let pageAdd: PageAdd | null = null;
function mount(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  vi.stubGlobal("fetch", fetchMock);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  pageAdd = null;
  render(
    <QueryClientProvider client={client}>
      <PageAddProvider
        value={(add) => {
          pageAdd = add;
        }}
      >
        <CategoriesPage />
      </PageAddProvider>
    </QueryClientProvider>,
  );
}
/** A category's actions button, whether it is a main category or a subcategory. */
const actionsButton = (name: string) =>
  screen.findByRole("button", { name: `Actions for ${name}` });
/** Open a category's actions sheet and return it. */
async function openActions(name: string) {
  await userEvent.click(await actionsButton(name));
  return screen.getByRole("dialog", { name });
}
/** Open a category's actions sheet and pick one of its rows. */
async function act(name: string, item: string) {
  const sheet = await openActions(name);
  await userEvent.click(within(sheet).getByRole("button", { name: item }));
}
/** The main categories of the kind on show, in order. */
const rowNames = () =>
  Array.from(
    document.querySelectorAll(
      '.cg-col[data-active="true"] .cg-toggle .ui-row-title',
    ),
  ).map((node) => node.textContent);
const ledger = (role = "owner") => ({
  items: [
    {
      id: ledgerId,
      name: "Personal",
      baseCurrency: "USD",
      timeZone: null,
      version: 1,
      role,
    },
  ],
});
it("offers manual or optional starter creation without silently writing", async () => {
  const fetchMock = vi.fn<typeof fetch>(async (url) =>
    String(url).includes("/categories")
      ? json({ items: [], nextCursor: null })
      : json(ledger()),
  );
  mount(fetchMock);
  await screen.findByText("No categories yet.");
  const starter = screen.getByRole("button", {
    name: "Add starter categories",
  });
  // Hover shows the hint (tied to the button); leaving or Escape hides it; nothing is written.
  await userEvent.hover(starter);
  const hint = screen.getByRole("tooltip");
  expect(starter).toHaveAccessibleDescription(/Hourly wages/);
  expect(hint).toHaveTextContent("Salary & wages");
  expect(hint).toHaveTextContent("Family support");
  expect(hint).not.toHaveTextContent("Student costs");
  await userEvent.keyboard("{Escape}");
  expect(hint).not.toBeVisible();
  await userEvent.click(starter);
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("Optional add-ons");
  expect(dialog).toHaveTextContent("Fees & interest");
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(fetchMock.mock.calls.every((call) => !call[1]?.method)).toBe(true);
});
it("permits viewer reads and filters without exposing mutation controls", async () => {
  const row = category("Food");
  mount(
    vi.fn<typeof fetch>(async (url) =>
      String(url).includes("/categories")
        ? json({ items: [row], nextCursor: null })
        : json(ledger("viewer")),
    ),
  );
  await screen.findByText("Food");
  expect(
    screen.queryByRole("button", {
      name: /Add.*category|Actions for.*/,
    }),
  ).not.toBeInTheDocument();
  expect(pageAdd).toBeNull();
});
it("loads every page before reordering and submits the complete unfiltered group", async () => {
  const rows = Array.from({ length: 101 }, (_, index) =>
    category(`Category ${index}`, { sortOrder: index }),
  );
  const last = rows[100];
  const second = rows[1];
  if (!last || !second) throw new Error("Missing fixture");
  const fetchMock = vi.fn<typeof fetch>(async (url, options) => {
    if (options?.method === "POST") return json({ items: rows });
    if (!String(url).includes("/categories")) return json(ledger());
    return String(url).includes("cursor=")
      ? json({ items: [last], nextCursor: null })
      : json({ items: rows.slice(0, 100), nextCursor: rows[99]?.id });
  });
  mount(fetchMock);
  await screen.findByText(last.name);
  fireEvent.change(screen.getByLabelText("Search categories"), {
    target: { value: second.name },
  });
  await act(second.name, "Move up");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some((call) => call[1]?.method === "POST"),
    ).toBe(true),
  );
  const body = JSON.parse(
    String(
      fetchMock.mock.calls.find((call) => call[1]?.method === "POST")?.[1]
        ?.body,
    ),
  );
  expect(body.items).toHaveLength(101);
  expect(body.items[0].id).toBe(second.id);
}, 15000);

it("saves each arrow click without a dialog and uses the returned versions on the next move", async () => {
  const first = category("Food", { sortOrder: 0 });
  const second = category("Transport", { sortOrder: 1 });
  let rows = [first, second];
  const writes: RequestInit[] = [];
  const fetchMock = vi.fn<typeof fetch>(async (url, options) => {
    if (options?.method === "POST") {
      writes.push(options);
      const body = JSON.parse(String(options.body));
      rows = body.items.map(
        (item: { id: string; expectedVersion: number }, index: number) => {
          const row = rows.find((row) => row.id === item.id);
          if (!row) throw new Error("Missing fixture");
          expect(item.expectedVersion).toBe(row.version);
          return { ...row, sortOrder: index, version: row.version + 1 };
        },
      );
      return json({ items: rows });
    }
    return String(url).includes("/categories")
      ? json({ items: rows, nextCursor: null })
      : json(ledger());
  });
  mount(fetchMock);
  await screen.findByText(first.name);
  await act("Transport", "Move up");
  await waitFor(() => expect(rowNames()).toEqual(["Transport", "Food"]));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(async () => {
    const sheet = await openActions("Transport");
    expect(
      within(sheet).getByRole("button", { name: "Move down" }),
    ).toBeEnabled();
    await userEvent.keyboard("{Escape}");
  });
  await act("Transport", "Move down");
  await waitFor(() => expect(rowNames()).toEqual(["Food", "Transport"]));
  expect(writes).toHaveLength(2);
  expect(new Headers(writes[0]?.headers).get("Idempotency-Key")).not.toBe(
    new Headers(writes[1]?.headers).get("Idempotency-Key"),
  );
});
it.each(["network", "server"] as const)(
  "retries an unconfirmed %s reorder inline with the same key and payload",
  async (failure) => {
    let rows = [
      category("Food", { sortOrder: 0 }),
      category("Transport", { sortOrder: 1 }),
    ];
    const writes: RequestInit[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (url, options) => {
      if (options?.method === "POST") {
        writes.push(options);
        if (writes.length === 1) {
          if (failure === "network") throw new TypeError("Interrupted");
          return json(
            { type: "about:blank", title: "Unavailable", status: 503 },
            503,
          );
        }
        rows = rows.map((row) => ({
          ...row,
          version: 2,
          sortOrder: 1 - row.sortOrder,
        }));
        return json({ items: rows });
      }
      return String(url).includes("/categories")
        ? json({ items: rows, nextCursor: null })
        : json(ledger());
    });
    mount(fetchMock);
    await screen.findByText("Transport");
    await act("Transport", "Move up");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't confirm the order",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add category" })).toBeDisabled();
    expect(pageAdd?.disabled).toBe(true);
    const locked = await openActions("Transport");
    expect(
      within(locked).getByRole("button", { name: "Move up" }),
    ).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Retry order" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Add category" }),
      ).toBeEnabled(),
    );
    expect(writes[1]?.body).toBe(writes[0]?.body);
    expect(new Headers(writes[1]?.headers).get("Idempotency-Key")).toBe(
      new Headers(writes[0]?.headers).get("Idempotency-Key"),
    );
    await waitFor(() => expect(rowNames()).toEqual(["Transport", "Food"]));
  },
);
it("requires an inline reload after a retry returns a definitive stale-order conflict", async () => {
  let rows = [
    category("Food", { sortOrder: 0 }),
    category("Transport", { sortOrder: 1 }),
  ];
  const writes: RequestInit[] = [];
  let reloadFails = true;
  const fetchMock = vi.fn<typeof fetch>(async (url, options) => {
    if (options?.method === "POST") {
      writes.push(options);
      if (writes.length === 1) throw new TypeError("Interrupted");
      if (writes.length === 2)
        return json(
          {
            type: "about:blank",
            title: "Conflict",
            status: 409,
            detail: "Reload.",
          },
          409,
        );
      const body = JSON.parse(String(options.body));
      expect(
        body.items.every(
          (item: { expectedVersion: number }) => item.expectedVersion === 3,
        ),
      ).toBe(true);
      rows = rows.map((row) => ({
        ...row,
        version: 4,
        sortOrder: 1 - row.sortOrder,
      }));
      return json({ items: rows });
    }
    if (!String(url).includes("/categories")) return json(ledger());
    if (writes.length === 2) {
      if (reloadFails) throw new TypeError("Interrupted reload");
      rows = rows.map((row) => ({ ...row, version: 3 }));
    }
    return json({ items: rows, nextCursor: null });
  });
  mount(fetchMock);
  await screen.findByText("Transport");
  await act("Transport", "Move up");
  await screen.findByRole("alert");
  await userEvent.click(screen.getByRole("button", { name: "Retry order" }));
  await screen.findByRole("button", { name: "Reload categories" });
  expect(
    screen.queryByRole("button", { name: "Retry order" }),
  ).not.toBeInTheDocument();
  const frozen = await openActions("Transport");
  expect(
    within(frozen).getByRole("button", { name: "Move up" }),
  ).toBeDisabled();
  await userEvent.keyboard("{Escape}");
  await userEvent.click(
    screen.getByRole("button", { name: "Reload categories" }),
  );
  await screen.findByText("Couldn't reload your categories. Please try again.");
  reloadFails = false;
  await userEvent.click(
    screen.getByRole("button", { name: "Reload categories" }),
  );
  await waitFor(async () => {
    const sheet = await openActions("Transport");
    expect(
      within(sheet).getByRole("button", { name: "Move up" }),
    ).toBeEnabled();
    await userEvent.keyboard("{Escape}");
  });
  expect(writes).toHaveLength(2);
  await act("Transport", "Move up");
  await waitFor(() => expect(writes).toHaveLength(3));
  expect(new Headers(writes[2]?.headers).get("Idempotency-Key")).not.toBe(
    new Headers(writes[1]?.headers).get("Idempotency-Key"),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("keeps an archived subcategory under its parent until the parent is unarchived, and a parent until its children are", async () => {
  const root = category("Food", {
    archivedAt: "2026-10-07T01:00:00.000Z",
    version: 2,
  });
  const child = category("Groceries", {
    parentId: root.id,
    archivedAt: root.archivedAt,
    version: 2,
  });
  let rows = [root, child];
  const writes: RequestInit[] = [];
  mount(
    vi.fn<typeof fetch>(async (url, options) => {
      if (options?.method === "POST") {
        writes.push(options);
        const row = rows.find((row) => String(url).includes(row.id));
        if (!row) throw new Error("Missing fixture");
        const saved = { ...row, archivedAt: null, version: 3 };
        rows = rows.map((item) => (item.id === row.id ? saved : item));
        return json(saved);
      }
      return String(url).includes("/categories")
        ? json({ items: rows, nextCursor: null })
        : json(ledger());
    }),
  );
  await screen.findByText("Food");
  // The subcategory shows once its parent is opened.
  await userEvent.click(screen.getByRole("button", { name: /^Food/ }));
  const blocked = await openActions("Groceries");
  const unarchiveChild = within(blocked).getByRole("button", {
    name: /^Unarchive/,
  });
  expect(unarchiveChild).toBeDisabled();
  expect(unarchiveChild).toHaveTextContent("Unarchive the main category first");
  await userEvent.keyboard("{Escape}");
  await act("Food", "Unarchive");
  const ask = await screen.findByRole("dialog", { name: "Unarchive Food?" });
  await userEvent.click(within(ask).getByRole("button", { name: "Unarchive" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(JSON.parse(String(writes[0]?.body))).toEqual({ expectedVersion: 2 });
  await waitFor(async () => {
    const sheet = await openActions("Groceries");
    expect(
      within(sheet).getByRole("button", { name: /^Unarchive/ }),
    ).toBeEnabled();
    await userEvent.keyboard("{Escape}");
  });
  await act("Groceries", "Unarchive");
  await userEvent.click(
    within(
      await screen.findByRole("dialog", { name: "Unarchive Groceries?" }),
    ).getByRole("button", { name: "Unarchive" }),
  );
  await waitFor(() => expect(writes).toHaveLength(2));
  const food = await openActions("Food");
  const archiveFood = within(food).getByRole("button", { name: /^Archive/ });
  await waitFor(() => expect(archiveFood).toBeDisabled());
  expect(archiveFood).toHaveTextContent("Archive its subcategories first");
});
it("offers a just-created parent immediately while the list refresh is pending", async () => {
  const root = category("New parent");
  let created = false;
  let finishRefresh: ((response: Response) => void) | undefined;
  mount(
    vi.fn<typeof fetch>(async (url, options) => {
      if (!String(url).includes("/categories")) return json(ledger());
      if (options?.method === "POST") {
        created = true;
        return json(root, 201);
      }
      if (created)
        return new Promise<Response>((resolve) => {
          finishRefresh = resolve;
        });
      return json({ items: [], nextCursor: null });
    }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Add your first category" }),
  );
  await userEvent.type(screen.getByLabelText("Category name"), "New parent");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByText("New parent")).toBeInTheDocument();
  await waitFor(() => expect(finishRefresh).toBeDefined());
  finishRefresh?.(json({ items: [root], nextCursor: null }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Add category" })).toBeEnabled(),
  );
  await userEvent.click(screen.getByRole("button", { name: "Add category" }));
  await userEvent.click(
    await screen.findByLabelText("Parent category", { exact: true }),
  );
  expect(
    await screen.findByRole("option", { name: "New parent" }),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole("option", { name: root.name }));
  expect(screen.getByLabelText("Parent category", { exact: true })).toHaveValue(
    root.name,
  );
});

const listMock = (rows: ReturnType<typeof category>[], role = "owner") =>
  vi.fn<typeof fetch>(async (url) =>
    String(url).includes("/categories")
      ? json({ items: rows, nextCursor: null })
      : json(ledger(role)),
  );
const food = category("Food", { sortOrder: 0 });
const groceries = category("Groceries", { parentId: food.id, sortOrder: 0 });
const dining = category("Dining", { parentId: food.id, sortOrder: 1 });
const rent = category("Rent", { sortOrder: 1 });
const salary = category("Salary", { kind: "income", sortOrder: 0 });
const retired = category("Retired", {
  sortOrder: 2,
  archivedAt: "2026-10-07T01:00:00.000Z",
});

it("lists a main category with its one hint, closed, and opens it to its subcategories", async () => {
  mount(listMock([food, groceries, dining, rent, salary]));
  const row = await screen.findByRole("button", { name: /^Food/ });
  expect(row).toHaveAttribute("aria-expanded", "false");
  expect(row).toHaveTextContent("2 subcategories");
  // A main category with nothing under it is a plain row, not a button that opens nothing.
  expect(screen.getByText("Rent")).toBeInTheDocument();
  expect(screen.getByText("Rent").closest(".cg-toggle")?.textContent).toContain(
    "No subcategories",
  );
  expect(screen.queryByRole("button", { name: /^Rent/ })).toBeNull();
  expect(screen.queryByText("Groceries")).not.toBeInTheDocument();
  await userEvent.click(row);
  expect(row).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Groceries")).toBeInTheDocument();
  expect(screen.getByText("Dining")).toBeInTheDocument();
  await userEvent.click(row);
  expect(screen.queryByText("Groceries")).not.toBeInTheDocument();
});
it("counts the main categories beside Expense and Income and shows one kind at a time through the switch", async () => {
  mount(listMock([food, rent, salary]));
  await screen.findByText("Food");
  const kind = screen.getByRole("radiogroup", { name: "Category kind" });
  expect(within(kind).getByRole("radio", { name: "Expense 2" })).toBeChecked();
  expect(within(kind).getByRole("radio", { name: "Income 1" })).toBeTruthy();
  expect(
    document
      .querySelector('.cg-col[data-active="true"]')
      ?.textContent?.includes("Food"),
  ).toBe(true);
  await userEvent.click(within(kind).getByRole("radio", { name: "Income 1" }));
  expect(rowNames()).toEqual(["Salary"]);
});
it("opens every group while searching, and filters on the subcategory's name", async () => {
  mount(listMock([food, groceries, dining, rent]));
  await screen.findByText("Food");
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search categories" }),
    {
      target: { value: "groc" },
    },
  );
  expect(screen.getByText("Groceries")).toBeInTheDocument();
  expect(screen.queryByText("Dining")).not.toBeInTheDocument();
  expect(screen.queryByText("Rent")).not.toBeInTheDocument();
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search categories" }),
    {
      target: { value: "zzz" },
    },
  );
  // Both kinds are in the page (the switch only shows one under 700 px), and both are empty now.
  expect(screen.getAllByText("No matching categories.")).toHaveLength(2);
});
it("expands and collapses every group at once", async () => {
  mount(listMock([food, groceries, dining, rent]));
  await screen.findByText("Food");
  await userEvent.click(screen.getByRole("button", { name: "Expand all" }));
  expect(screen.getByText("Groceries")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Collapse all" }));
  expect(screen.queryByText("Groceries")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Expand all" })).toBeTruthy();
});
it("has the status chips only while something is archived, with All until one is chosen", async () => {
  mount(listMock([food, rent]));
  await screen.findByText("Food");
  expect(screen.queryByRole("group", { name: "View categories" })).toBeNull();
  cleanup();
  mount(listMock([food, retired]));
  await screen.findByText("Food");
  const chips = screen.getByRole("group", { name: "View categories" });
  expect(rowNames()).toEqual(["Food", "Retired"]);
  await userEvent.click(within(chips).getByRole("button", { name: "Active" }));
  expect(rowNames()).toEqual(["Food"]);
  await userEvent.click(
    within(chips).getByRole("button", { name: "Archived" }),
  );
  expect(rowNames()).toEqual(["Retired"]);
  expect(
    screen.getByText("Retired").closest(".cg-toggle")?.textContent,
  ).toContain("Archived");
  await userEvent.click(within(chips).getByRole("button", { name: "All" }));
  expect(rowNames()).toEqual(["Food", "Retired"]);
});
it("opens one actions sheet per category with every action, Delete last and the unavailable ones disabled with a reason", async () => {
  mount(listMock([food, groceries, rent]));
  await screen.findByText("Food");
  const sheet = await openActions("Food");
  const names = within(sheet)
    .getAllByRole("button")
    .map((b) => b.querySelector(".ui-row-title")?.textContent ?? b.textContent)
    .filter((t) => t !== "Cancel");
  expect(names).toEqual([
    "Edit",
    "Add subcategory",
    "Move up",
    "Move down",
    "Archive",
    "Delete",
  ]);
  expect(
    within(sheet).getByRole("button", { name: /^Move up/ }),
  ).toBeDisabled();
  expect(
    within(sheet).getByRole("button", { name: /^Move down/ }),
  ).toBeEnabled();
  expect(
    within(sheet).getByRole("button", { name: /^Archive/ }),
  ).toBeDisabled();
  expect(
    within(sheet).getByRole("button", { name: /^Archive/ }),
  ).toHaveTextContent("Archive its subcategories first");
  await userEvent.keyboard("{Escape}");
  const rentSheet = await openActions("Rent");
  expect(
    within(rentSheet).getByRole("button", { name: /^Archive/ }),
  ).toBeEnabled();
});
it("has no Add subcategory for a subcategory, and no Move for an archived category", async () => {
  mount(listMock([food, groceries, retired]));
  await screen.findByText("Food");
  await userEvent.click(screen.getByRole("button", { name: /^Food/ }));
  const sub = await openActions("Groceries");
  expect(
    within(sub).queryByRole("button", { name: "Add subcategory" }),
  ).toBeNull();
  await userEvent.keyboard("{Escape}");
  const old = await openActions("Retired");
  expect(within(old).queryByRole("button", { name: /^Move/ })).toBeNull();
  expect(
    within(old).queryByRole("button", { name: "Add subcategory" }),
  ).toBeNull();
  expect(within(old).getByRole("button", { name: "Unarchive" })).toBeEnabled();
});
it("adds a subcategory under the chosen main category, and the editor starts on it", async () => {
  mount(listMock([food, rent]));
  await screen.findByText("Food");
  await act("Food", "Add subcategory");
  const dialog = await screen.findByRole("dialog", { name: "Add category" });
  expect(
    within(dialog).getByLabelText("Parent category", { exact: true }),
  ).toHaveValue("Food");
  expect(within(dialog).getByRole("radio", { name: "Expense" })).toBeChecked();
});
it("edits a category from its sheet", async () => {
  mount(listMock([food]));
  await screen.findByText("Food");
  await act("Food", "Edit");
  const dialog = await screen.findByRole("dialog", { name: "Edit category" });
  expect(within(dialog).getByLabelText("Category name")).toHaveValue("Food");
});
it("asks before deleting, in a question with Delete in red", async () => {
  mount(listMock([rent]));
  await screen.findByText("Rent");
  await act("Rent", "Delete");
  const ask = await screen.findByRole("dialog", { name: "Delete Rent?" });
  expect(ask.className).toContain("ui-question");
  expect(ask).toHaveTextContent("A deleted category has no Undo");
  expect(
    within(ask).getByRole("button", { name: "Delete" }).className,
  ).toContain("danger");
});
it("the phone's one Add button adds a category, and is for writers with something listed", async () => {
  mount(listMock([food]));
  await screen.findByText("Food");
  await waitFor(() => expect(pageAdd?.label).toBe("Add category"));
  pageAdd?.onClick();
  expect(
    await screen.findByRole("dialog", { name: "Add category" }),
  ).toBeTruthy();
  cleanup();
  mount(listMock([]));
  await screen.findByText("No categories yet.");
  expect(pageAdd).toBeNull();
});
it("starts a new category on the kind on show", async () => {
  mount(listMock([food, salary]));
  await screen.findByText("Food");
  await userEvent.click(screen.getByRole("radio", { name: "Income 1" }));
  await userEvent.click(screen.getByRole("button", { name: "Add category" }));
  const dialog = await screen.findByRole("dialog", { name: "Add category" });
  expect(within(dialog).getByRole("radio", { name: "Income" })).toBeChecked();
});
it("shows a viewer the list and a note, and opens nothing", async () => {
  mount(listMock([food, groceries], "viewer"));
  await screen.findByText("Food");
  expect(
    screen.getByText("You have read-only access to this ledger."),
  ).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: /^Food/ }));
  expect(screen.getByText("Groceries")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Groceries/ })).toBeNull();
});
it("says it could not load categories, and tries again", async () => {
  let fail = true;
  mount(
    vi.fn<typeof fetch>(async (url) =>
      String(url).includes("/categories")
        ? fail
          ? new Response("{}", { status: 500 })
          : json({ items: [food], nextCursor: null })
        : json(ledger()),
    ),
  );
  expect(
    await screen.findByText("Couldn't load your categories."),
  ).toBeTruthy();
  fail = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Food")).toBeTruthy();
});

it("shows Delete in red and keeps the other rows plain", async () => {
  mount(listMock([rent]));
  await screen.findByText("Rent");
  const sheet = await openActions("Rent");
  const title = (name: string) =>
    within(sheet).getByText(name, { selector: ".ui-row-title" });
  expect(title("Delete").className).toContain("cg-danger");
  expect(title("Edit").className).not.toContain("cg-danger");
  expect(title("Archive").className).not.toContain("cg-danger");
});
it("says Category updated after saving an edit", async () => {
  const fetchMock = vi.fn<typeof fetch>(async (url, options) => {
    if (options?.method === "PATCH")
      return json({ ...food, name: "Dinner", version: 2 });
    return String(url).includes("/categories")
      ? json({ items: [food], nextCursor: null })
      : json(ledger());
  });
  mount(fetchMock);
  await screen.findByText("Food");
  await act("Food", "Edit");
  const dialog = await screen.findByRole("dialog", { name: "Edit category" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(
    await screen.findByText("Category updated.", { selector: "p" }),
  ).toBeInTheDocument();
});
it("starts a subcategory on its parent's kind, whichever kind is on show", async () => {
  mount(listMock([food, salary]));
  await screen.findByText("Food");
  // The switch is on Expense; Salary is an income main category.
  await act("Salary", "Add subcategory");
  const dialog = await screen.findByRole("dialog", { name: "Add category" });
  expect(within(dialog).getByRole("radio", { name: "Income" })).toBeChecked();
  expect(
    within(dialog).getByLabelText("Parent category", { exact: true }),
  ).toHaveValue("Salary");
});
