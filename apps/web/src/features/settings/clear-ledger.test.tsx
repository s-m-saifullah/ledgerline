import { newId } from "@ledgerline/shared";
import { ListCard } from "@ledgerline/ui";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { json } from "../../test-support/category-fixtures";
import { ClearLedger } from "./clear-ledger";

const DAY = 24 * 60 * 60 * 1000;
const ledgerId = newId();
const ledger = (over: Record<string, unknown> = {}) => ({
  id: ledgerId,
  name: "Personal",
  baseCurrency: "USD",
  timeZone: "UTC",
  version: 4,
  role: "owner",
  ...over,
});
const problem = (status: number, detail: string) =>
  json({ type: "about:blank", title: "x", status, detail, errors: [] }, status);

type Write = { url: string; method: string; body: unknown; key: string | null };
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
});

/** Something else the app holds, to see that a clear makes it read again. */
function Probe({ onRead }: { onRead: () => void }) {
  useQuery({
    queryKey: ["accounts", ledgerId],
    queryFn: async () => {
      onRead();
      return [];
    },
  });
  return null;
}

function mount({
  current = ledger(),
  write = (_write: Write): Response | undefined => undefined,
} = {}) {
  const writes: Write[] = [];
  const reads: string[] = [];
  const notices: string[] = [];
  const probeReads = vi.fn();
  const state = { current };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url, init) => {
      const path = String(url);
      if (init?.method && init.method !== "GET") {
        const entry = {
          url: path,
          method: init.method,
          body: JSON.parse(String(init.body ?? "null")),
          key: new Headers(init.headers).get("Idempotency-Key"),
        };
        writes.push(entry);
        const custom = write(entry);
        if (custom) return custom;
        return json(state.current);
      }
      reads.push(path);
      if (path.endsWith("/ledgers")) return json({ items: [state.current] });
      return json({});
    }),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Probe onRead={probeReads} />
      <ListCard>
        <ClearLedger onNotice={(text) => notices.push(text)} />
      </ListCard>
      <h1 id="settings-title" tabIndex={-1}>
        Settings
      </h1>
    </QueryClientProvider>,
  );
  return { writes, reads, notices, probeReads, state };
}
const titles = () =>
  [...document.querySelectorAll(".ui-row-title")].map((t) => t.textContent);
const question = () => screen.getAllByRole("dialog").at(-1) as HTMLElement;
const clearedAt = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * DAY).toISOString();

it("offers Clear ledger in red with its one short hint, and no restore while nothing waits", async () => {
  mount();
  await screen.findByRole("button", { name: /Clear ledger/ });
  expect(titles()).toEqual(["Clear ledger"]);
  expect(document.querySelector(".set-danger")).toHaveTextContent(
    "Clear ledger",
  );
  expect(screen.getByText("Undo for 30 days")).toBeInTheDocument();
});

it("reads a ledger without clearedAt, or with null, as nothing to restore", async () => {
  mount({ current: ledger({ clearedAt: null }) });
  await screen.findByRole("button", { name: /Clear ledger/ });
  expect(screen.queryByText(/Restore cleared ledger/)).toBeNull();
});

it("shows nothing at all to an editor or a viewer, who cannot clear a ledger", async () => {
  for (const role of ["editor", "viewer"]) {
    const { reads } = mount({ current: ledger({ role }) });
    await waitFor(() =>
      expect(reads.some((read) => read.endsWith("/ledgers"))).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(titles()).toEqual([]);
    cleanup();
  }
});

it("shows nothing while the ledger is still loading", () => {
  mount();
  expect(titles()).toEqual([]);
});

it("puts 'Restore cleared ledger' with its days left above 'Clear ledger' while an undo waits", async () => {
  // Cleared 12.5 days ago: 17.5 of the 30 days are left, which reads as 18.
  mount({ current: ledger({ clearedAt: clearedAt(12.5) }) });
  await screen.findByRole("button", { name: /Restore cleared ledger/ });
  expect(titles()).toEqual(["Restore cleared ledger", "Clear ledger"]);
  expect(screen.getByText("18 days left")).toBeInTheDocument();
});

it("says '1 day left' on the last day of an undo", async () => {
  mount({ current: ledger({ clearedAt: clearedAt(29.9) }) });
  expect(await screen.findByText("1 day left")).toBeInTheDocument();
});

it("clears only after CLEAR is typed, in any letter case, then says so and makes the app read everything again", async () => {
  const user = userEvent.setup();
  const { writes, notices, probeReads, reads } = mount();
  await user.click(await screen.findByRole("button", { name: /Clear ledger/ }));
  expect(question()).toHaveAccessibleName("Clear your ledger?");
  expect(question()).toHaveTextContent(
    "Your accounts, entries and budgets leave the app so you can start fresh. You can undo this for 30 days.",
  );
  const confirm = within(question()).getByRole("button", { name: "Clear" });
  expect(confirm).toHaveClass("ui-btn-danger-filled");
  expect(confirm).toBeDisabled();
  const typed = within(question()).getByLabelText("Type CLEAR to confirm");
  expect(typed).toHaveAttribute("placeholder", "CLEAR");
  await user.type(typed, "clea");
  expect(confirm).toBeDisabled();
  await user.type(typed, "r ");
  expect(confirm).toBeEnabled();
  const before = probeReads.mock.calls.length;
  const ledgerReads = reads.filter((read) => read.endsWith("/ledgers")).length;
  await user.click(confirm);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    url: `/api/v1/ledgers/${ledgerId}/clear`,
    method: "POST",
    body: { confirm: "CLEAR" },
  });
  expect(writes[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
  expect(notices).toEqual(["Ledger cleared."]);
  await waitFor(() => {
    expect(probeReads.mock.calls.length).toBeGreaterThan(before);
    expect(
      reads.filter((read) => read.endsWith("/ledgers")).length,
    ).toBeGreaterThan(ledgerReads);
  });
});

it("does not clear on Enter while the word is wrong, and writes nothing when cancelled", async () => {
  const user = userEvent.setup();
  const { writes } = mount();
  await user.click(await screen.findByRole("button", { name: /Clear ledger/ }));
  await user.type(
    within(question()).getByLabelText("Type CLEAR to confirm"),
    "cl{Enter}",
  );
  await user.click(within(question()).getByRole("button", { name: "Cancel" }));
  expect(writes).toEqual([]);
});

it("empties the box when the question is cancelled and opened again", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole("button", { name: /Clear ledger/ }));
  await user.type(
    within(question()).getByLabelText("Type CLEAR to confirm"),
    "CLEAR",
  );
  await user.click(within(question()).getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: /Clear ledger/ }));
  expect(
    within(question()).getByLabelText("Type CLEAR to confirm"),
  ).toHaveValue("");
});

it("keeps the same key when a lost answer is tried again, and a new one after it has worked", async () => {
  const user = userEvent.setup();
  let lose = true;
  const { writes } = mount({
    write: () => {
      if (!lose) return undefined;
      lose = false;
      return problem(500, "boom");
    },
  });
  await user.click(await screen.findByRole("button", { name: /Clear ledger/ }));
  await user.type(
    within(question()).getByLabelText("Type CLEAR to confirm"),
    "CLEAR",
  );
  await user.click(within(question()).getByRole("button", { name: "Clear" }));
  expect(await within(question()).findByRole("alert")).toHaveTextContent(
    "We couldn't confirm that. Please try again.",
  );
  await user.click(within(question()).getByRole("button", { name: "Clear" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(writes).toHaveLength(2);
  expect(writes[1]?.key).toBe(writes[0]?.key);
});

it("shows the server's refusal inside the question and keeps it open", async () => {
  const user = userEvent.setup();
  mount({ write: () => problem(403, "Only the owner can clear this ledger.") });
  await user.click(await screen.findByRole("button", { name: /Clear ledger/ }));
  await user.type(
    within(question()).getByLabelText("Type CLEAR to confirm"),
    "CLEAR",
  );
  await user.click(within(question()).getByRole("button", { name: "Clear" }));
  expect(await within(question()).findByRole("alert")).toHaveTextContent(
    "Only the owner can clear this ledger.",
  );
});

it("restores a cleared ledger after a question with no typing, in the calm button colour", async () => {
  const user = userEvent.setup();
  const { writes, notices, probeReads } = mount({
    current: ledger({ clearedAt: clearedAt(5) }),
  });
  await user.click(
    await screen.findByRole("button", { name: /Restore cleared ledger/ }),
  );
  expect(question()).toHaveAccessibleName("Restore your cleared ledger?");
  expect(question()).toHaveTextContent(
    "Everything comes back as it was. This works only while your ledger is empty.",
  );
  expect(within(question()).queryByLabelText(/Type/)).toBeNull();
  const confirm = within(question()).getByRole("button", { name: "Restore" });
  expect(confirm).not.toHaveClass("ui-btn-danger-filled");
  const before = probeReads.mock.calls.length;
  await user.click(confirm);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    url: `/api/v1/ledgers/${ledgerId}/restore`,
    method: "POST",
    body: {},
  });
  expect(notices).toEqual(["Ledger restored."]);
  await waitFor(() =>
    expect(probeReads.mock.calls.length).toBeGreaterThan(before),
  );
});

it("shows 'Clear what is there now first.' inside the restore question", async () => {
  const user = userEvent.setup();
  mount({
    current: ledger({ clearedAt: clearedAt(5) }),
    write: () => problem(409, "Clear what is there now first."),
  });
  await user.click(
    await screen.findByRole("button", { name: /Restore cleared ledger/ }),
  );
  await user.click(within(question()).getByRole("button", { name: "Restore" }));
  expect(await within(question()).findByRole("alert")).toHaveTextContent(
    "Clear what is there now first.",
  );
  expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(1);
});

const openClear = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("button", { name: /Clear ledger/ }));
  await user.type(
    within(question()).getByLabelText("Type CLEAR to confirm"),
    "CLEAR",
  );
};

it("uses a new key after a refusal, because a refusal is a final answer", async () => {
  const user = userEvent.setup();
  let refuse = true;
  const { writes } = mount({
    write: () => {
      if (!refuse) return undefined;
      refuse = false;
      return problem(409, "Not now.");
    },
  });
  await openClear(user);
  await user.click(within(question()).getByRole("button", { name: "Clear" }));
  await within(question()).findByRole("alert");
  await user.click(within(question()).getByRole("button", { name: "Clear" }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]?.key).not.toBe(writes[0]?.key);
});

it("uses a new key when the question is cancelled after a lost answer and opened again", async () => {
  const user = userEvent.setup();
  let lose = true;
  const { writes } = mount({
    write: () => {
      if (!lose) return undefined;
      lose = false;
      return problem(500, "boom");
    },
  });
  await openClear(user);
  await user.click(within(question()).getByRole("button", { name: "Clear" }));
  await within(question()).findByRole("alert");
  await user.click(within(question()).getByRole("button", { name: "Cancel" }));
  await openClear(user);
  await user.click(within(question()).getByRole("button", { name: "Clear" }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]?.key).not.toBe(writes[0]?.key);
});

it("uses a new key for a second clear after the first one worked", async () => {
  const user = userEvent.setup();
  const { writes } = mount();
  await openClear(user);
  await user.click(within(question()).getByRole("button", { name: "Clear" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await openClear(user);
  await user.click(within(question()).getByRole("button", { name: "Clear" }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]?.key).not.toBe(writes[0]?.key);
});

it("shows no old error when the question is cancelled and opened again", async () => {
  const user = userEvent.setup();
  mount({ write: () => problem(500, "boom") });
  await openClear(user);
  await user.click(within(question()).getByRole("button", { name: "Clear" }));
  await within(question()).findByRole("alert");
  await user.click(within(question()).getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: /Clear ledger/ }));
  expect(within(question()).queryByRole("alert")).toBeNull();
});
