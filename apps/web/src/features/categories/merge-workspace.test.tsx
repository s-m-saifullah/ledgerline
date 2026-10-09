import type { CategoryMergePreview } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  category,
  chooseCategory,
  json,
  ledgerId,
} from "./fixtures.test-helper";
import {
  CategoryMergeWorkspace,
  useCategoryMergeWorkspace,
} from "./merge-workspace";

const source = category("Source"),
  target = category("Destination"),
  other = category("Other");
const preview = (destination = target): CategoryMergePreview => ({
  source,
  destination,
  canMerge: true,
  blockers: [],
  expectedSourceVersion: 1,
  expectedDestinationVersion: 1,
  previewToken: "a".repeat(64),
  summary: {
    ordinaryCleared: 2,
    ordinaryPending: 1,
    splitLines: 3,
    splitParents: 1,
    linkedPayments: 0,
    receivables: 0,
    children: [],
    excludedTransactions: 1,
    excludedSplitLines: 0,
    excludedPayments: 0,
    excludedChildren: 0,
  },
});
const result = {
  source: { ...source, version: 2, archivedAt: source.createdAt },
  destination: { ...target, version: 2 },
  summary: preview().summary,
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function Controls() {
  const workspace = useCategoryMergeWorkspace();
  const [route, setRoute] = useState("Categories");
  return (
    <>
      <button
        id="opener"
        type="button"
        disabled={workspace?.blocked}
        onClick={() => workspace?.begin(source, "opener")}
      >
        Start merge
      </button>
      <button type="button" disabled={workspace?.blocked}>
        Competing write
      </button>
      <button type="button" onClick={() => setRoute("Transactions")}>
        Navigate
      </button>
      <main id="main-content" tabIndex={-1}>
        {route}
      </main>
    </>
  );
}
function mount(writable = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CategoryMergeWorkspace
        ledgerId={ledgerId}
        writable={writable}
        blocked={false}
        onLock={vi.fn()}
      >
        <Controls />
      </CategoryMergeWorkspace>
    </QueryClientProvider>,
  );
  return client;
}
function mockFetch(
  post: (init: RequestInit) => Promise<Response>,
  getPreview: (url: string) => Promise<Response> = async () => json(preview()),
) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (init?.method === "POST") return post(init);
    if (url.includes("merge-preview")) return getPreview(url);
    return json({ items: [source, target, other], nextCursor: null });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
async function selectTarget() {
  await userEvent.click(screen.getByRole("button", { name: "Start merge" }));
  await chooseCategory("Destination category", target.name);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Confirm merge" })).toBeEnabled(),
  );
}
it("keeps one immutable key/body through an uncertain result, closing and navigation; refreshes dependent queries once confirmed", async () => {
  let first = true;
  const fetchMock = mockFetch(async () => {
    if (first) {
      first = false;
      throw new TypeError("Interrupted");
    }
    return json(result);
  });
  const client = mount(),
    invalidate = vi.spyOn(client, "invalidateQueries");
  await selectTarget();
  await userEvent.click(screen.getByRole("button", { name: "Confirm merge" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Retry the same action",
  );
  expect(
    screen.getByLabelText("Destination category", { exact: true }),
  ).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Close for now" }));
  expect(
    screen.getByRole("button", { name: "Competing write" }),
  ).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Navigate" }));
  expect(screen.getByRole("main")).toHaveTextContent("Transactions");
  await userEvent.click(
    screen.getByRole("button", { name: "Resume category merge" }),
  );
  expect(
    screen.getByRole("button", { name: "Retry same merge" }),
  ).toHaveFocus();
  await userEvent.click(
    screen.getByRole("button", { name: "Retry same merge" }),
  );
  await screen.findByText("Categories merged. The source is archived.");
  const writes = fetchMock.mock.calls.filter(
    ([, init]) => init?.method === "POST",
  );
  expect(writes).toHaveLength(2);
  expect(writes[1]?.[1]?.body).toBe(writes[0]?.[1]?.body);
  expect(new Headers(writes[1]?.[1]?.headers).get("Idempotency-Key")).toBe(
    new Headers(writes[0]?.[1]?.headers).get("Idempotency-Key"),
  );
  expect(
    fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("merge-preview"),
    ),
  ).toHaveLength(1);
  expect(
    invalidate.mock.calls.map(([options]) => options?.queryKey?.[0]),
  ).toEqual([
    "categories",
    "transactions",
    "contacts",
    "receivables",
    "peopleHistory",
    "accounts",
    "home",
  ]);
  expect(screen.getByRole("button", { name: "Competing write" })).toBeEnabled();
});
it("requires deliberate reload after a definitive conflict and prepares a fresh key and token", async () => {
  let writes = 0,
    reads = 0;
  const fetchMock = mockFetch(
    async () =>
      ++writes === 1
        ? json(
            {
              type: "about:blank",
              title: "Conflict",
              status: 409,
              detail: "Preview changed.",
            },
            409,
          )
        : json(result),
    async () =>
      json({
        ...preview(),
        previewToken: (++reads === 1 ? "a" : "b").repeat(64),
      }),
  );
  mount();
  await selectTarget();
  await userEvent.click(screen.getByRole("button", { name: "Confirm merge" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Preview changed");
  expect(screen.getByRole("button", { name: "Confirm merge" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Reload preview" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Confirm merge" })).toBeEnabled(),
  );
  await userEvent.click(screen.getByRole("button", { name: "Confirm merge" }));
  await screen.findByText("Categories merged. The source is archived.");
  const posts = fetchMock.mock.calls.filter(
    ([, init]) => init?.method === "POST",
  );
  expect(new Headers(posts[1]?.[1]?.headers).get("Idempotency-Key")).not.toBe(
    new Headers(posts[0]?.[1]?.headers).get("Idempotency-Key"),
  );
  expect(JSON.parse(String(posts[1]?.[1]?.body)).previewToken).toBe(
    "b".repeat(64),
  );
});
it("discards an old preview that arrives after a new destination has been selected", async () => {
  let resolveOld: ((value: Response) => void) | undefined;
  mockFetch(
    async () => json(result),
    async (url) =>
      url.includes(target.id)
        ? new Promise<Response>((resolve) => {
            resolveOld = resolve;
          })
        : json(preview(other)),
  );
  mount();
  await userEvent.click(screen.getByRole("button", { name: "Start merge" }));
  await chooseCategory("Destination category", target.name);
  expect(screen.getByRole("button", { name: "Confirm merge" })).toBeDisabled();
  await chooseCategory("Destination category", other.name);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Confirm merge" })).toBeEnabled(),
  );
  await act(async () => resolveOld?.(json(preview(target))));
  expect(
    screen.getByRole("region", { name: "Merge preview" }),
  ).toHaveTextContent("Other");
  expect(
    screen.getByRole("region", { name: "Merge preview" }),
  ).not.toHaveTextContent("Destination");
});
it("shows blockers without a confirmation and cancels back to the opener", async () => {
  mockFetch(
    async () => json(result),
    async () =>
      json({
        ...preview(),
        canMerge: false,
        previewToken: null,
        blockers: [
          {
            code: "childNameConflict",
            message: "Rename the archived child first.",
          },
        ],
      }),
  );
  mount();
  await userEvent.click(screen.getByRole("button", { name: "Start merge" }));
  await chooseCategory("Destination category", target.name);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Rename the archived child",
  );
  expect(screen.getByRole("button", { name: "Confirm merge" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Start merge" })).toHaveFocus(),
  );
});
it("does not open a mutation for viewers", async () => {
  mockFetch(async () => json(result));
  mount(false);
  await userEvent.click(screen.getByRole("button", { name: "Start merge" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
