import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { type CategoryAction, CategoryActionDialog } from "./action-dialog";
import { category, json, ledgerId } from "./fixtures.test-helper";

const root = category("Food");
const actions: CategoryAction[] = [
  { kind: "archive", category: root },
  { kind: "delete", category: root },
  { kind: "starter" },
  {
    kind: "unarchive",
    category: { ...root, archivedAt: "2026-10-07T01:00:00.000Z", version: 2 },
  },
];
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it.each(actions)(
  "retains the prepared $kind action across interruption and close/resume",
  async (action) => {
    const result =
      action.kind === "archive"
        ? { ...root, archivedAt: "2026-10-07T01:00:00.000Z", version: 2 }
        : action.kind === "unarchive"
          ? { ...root, archivedAt: null, version: 3 }
          : { items: [root] };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Interrupted"))
      .mockResolvedValue(
        action.kind === "delete"
          ? new Response(null, { status: 204 })
          : json(result),
      );
    vi.stubGlobal("fetch", fetchMock);
    const saved = vi.fn();
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Resume
          </button>
          <CategoryActionDialog
            ledgerId={ledgerId}
            action={action}
            open={open}
            onDismiss={() => setOpen(false)}
            onUnconfirmed={vi.fn()}
            onSaved={saved}
            onReloaded={vi.fn()}
          />
        </>
      );
    }
    render(<Host />);
    const label =
      action.kind === "delete"
        ? "Delete category"
        : action.kind === "archive"
          ? "Archive category"
          : action.kind === "unarchive"
            ? "Unarchive category"
            : "Create categories";
    await userEvent.click(screen.getByRole("button", { name: label }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "couldn't confirm this action",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Close for now" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    await userEvent.click(screen.getByRole("button", { name: "Retry action" }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      fetchMock.mock.calls[0]?.[1]?.body,
    );
    expect(
      new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("Idempotency-Key"),
    ).toBe(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Idempotency-Key"),
    );
  },
);
it("creates only the ticked starter groups and needs at least one", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(json({ items: [root] }));
  vi.stubGlobal("fetch", fetchMock);
  render(
    <CategoryActionDialog
      ledgerId={ledgerId}
      action={{ kind: "starter" }}
      open
      onDismiss={vi.fn()}
      onUnconfirmed={vi.fn()}
      onSaved={vi.fn()}
      onReloaded={vi.fn()}
    />,
  );
  const checks = screen.getAllByRole("checkbox");
  expect(checks).toHaveLength(24);
  // Default groups start ticked; optional add-ons start unticked.
  expect(
    checks.filter((box) => (box as HTMLInputElement).checked),
  ).toHaveLength(18);
  for (const box of checks.slice(18)) expect(box).not.toBeChecked();
  for (const box of checks.slice(0, 18)) await userEvent.click(box);
  expect(
    screen.getByRole("button", { name: "Create categories" }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole("checkbox", { name: /^Salary & wages/ }),
  );
  await userEvent.click(screen.getByRole("checkbox", { name: /^Housing/ }));
  await userEvent.click(
    screen.getByRole("button", { name: "Create categories" }),
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
    starterSet: "default",
    groups: ["salary", "housing"],
  });
});
it("reloads a stale unarchive before a fresh action", async () => {
  const latest = { ...root, version: 3, archivedAt: null };
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      json(
        {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          detail: "This category changed. Reload it before trying again.",
        },
        409,
      ),
    )
    .mockResolvedValue(json({ items: [latest], nextCursor: null }));
  vi.stubGlobal("fetch", fetchMock);
  const reloaded = vi.fn();
  render(
    <CategoryActionDialog
      ledgerId={ledgerId}
      action={{
        kind: "unarchive",
        category: {
          ...root,
          version: 2,
          archivedAt: "2026-10-07T01:00:00.000Z",
        },
      }}
      open
      onDismiss={vi.fn()}
      onUnconfirmed={vi.fn()}
      onSaved={vi.fn()}
      onReloaded={reloaded}
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Unarchive category" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This category changed",
  );
  expect(
    screen.queryByRole("button", { name: "Unarchive category" }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Reload categories" }),
  );
  await waitFor(() => expect(reloaded).toHaveBeenCalledWith([latest]));
});
