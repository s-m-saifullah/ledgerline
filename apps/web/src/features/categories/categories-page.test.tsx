import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { CategoriesPage } from "./categories-page";
import { category, json, ledgerId } from "./fixtures.test-helper";

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
function mount(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  vi.stubGlobal("fetch", fetchMock);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CategoriesPage />
    </QueryClientProvider>,
  );
}
const ledger = (role = "owner") => ({
  items: [{ id: ledgerId, name: "Personal", baseCurrency: "USD", role }],
});
it("offers manual or optional starter creation without silently writing", async () => {
  const fetchMock = vi.fn<typeof fetch>(async (url) =>
    String(url).includes("/categories")
      ? json({ items: [], nextCursor: null })
      : json(ledger()),
  );
  mount(fetchMock);
  await screen.findByText("Make room for your categories.");
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
  await screen.findByRole("article", { name: "Food" });
  expect(
    screen.queryByRole("button", {
      name: /Add.*category|Edit.*|Archive.*|Move.*/,
    }),
  ).not.toBeInTheDocument();
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
  await screen.findByRole("article", { name: last.name });
  fireEvent.change(screen.getByLabelText("Search categories"), {
    target: { value: second.name },
  });
  await userEvent.click(
    screen.getByRole("button", { name: `Move ${second.name} up` }),
  );
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
  await screen.findByRole("article", { name: first.name });
  await userEvent.click(
    screen.getByRole("button", { name: "Move Transport up" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Move Transport down" }),
    ).toBeEnabled(),
  );
  expect(screen.getAllByRole("article")[0]).toHaveAccessibleName("Transport");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Move Transport down" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Move Transport up" }),
    ).toBeEnabled(),
  );
  expect(screen.getAllByRole("article")[0]).toHaveAccessibleName("Food");
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
    await screen.findByRole("article", { name: "Transport" });
    await userEvent.click(
      screen.getByRole("button", { name: "Move Transport up" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't confirm the order",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add category" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Transport up" }),
    ).toBeDisabled();
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
    expect(screen.getAllByRole("article")[0]).toHaveAccessibleName("Transport");
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
  await screen.findByRole("article", { name: "Transport" });
  await userEvent.click(
    screen.getByRole("button", { name: "Move Transport up" }),
  );
  await screen.findByRole("alert");
  await userEvent.click(screen.getByRole("button", { name: "Retry order" }));
  await screen.findByRole("button", { name: "Reload categories" });
  expect(
    screen.queryByRole("button", { name: "Retry order" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Move Transport up" }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "Reload categories" }),
  );
  await screen.findByText("Couldn't reload your categories. Please try again.");
  reloadFails = false;
  await userEvent.click(
    screen.getByRole("button", { name: "Reload categories" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Move Transport up" }),
    ).toBeEnabled(),
  );
  expect(writes).toHaveLength(2);
  await userEvent.click(
    screen.getByRole("button", { name: "Move Transport up" }),
  );
  await waitFor(() => expect(writes).toHaveLength(3));
  expect(new Headers(writes[2]?.headers).get("Idempotency-Key")).not.toBe(
    new Headers(writes[1]?.headers).get("Idempotency-Key"),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("offers labeled icon actions and requires the parent to be unarchived first", async () => {
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
  await screen.findByRole("article", { name: "Food" });
  const edit = screen.getByRole("button", { name: "Edit Food" });
  expect(edit).toHaveAttribute("title", "Edit category");
  expect(edit.textContent).toBe("");
  const restore = screen.getByRole("button", { name: "Unarchive Food" });
  expect(restore).toHaveAttribute("title", "Unarchive category");
  expect(restore.textContent).toBe("");
  expect(
    screen.getByRole("button", { name: "Unarchive Groceries" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Unarchive Groceries" }),
  ).toHaveAttribute("title", "Unarchive the parent first");
  await userEvent.click(restore);
  await userEvent.click(
    screen.getByRole("button", { name: "Unarchive category" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Unarchive Groceries" }),
    ).toBeEnabled(),
  );
  expect(screen.getByRole("button", { name: "Archive Food" })).toHaveAttribute(
    "title",
    "Archive category",
  );
  expect(JSON.parse(String(writes[0]?.body))).toEqual({ expectedVersion: 2 });
  await userEvent.click(
    screen.getByRole("button", { name: "Unarchive Groceries" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Unarchive category" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Archive Groceries" }),
    ).toBeEnabled(),
  );
  expect(screen.getByRole("button", { name: "Archive Food" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Archive Food" })).toHaveAttribute(
    "title",
    "Archive active children first",
  );
  expect(
    screen.queryByRole("button", { name: /^Unarchive / }),
  ).not.toBeInTheDocument();
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
  await userEvent.click(screen.getByRole("button", { name: "Add category" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("article", { name: "New parent" }),
  ).toBeInTheDocument();
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
