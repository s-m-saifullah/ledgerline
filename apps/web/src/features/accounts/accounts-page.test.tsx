import { type Account, newId } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { PrivacyContext } from "../../lib/preferences";
import { type PageAdd, PageAddProvider } from "../shell/page-add";
import { AccountsPage } from "./accounts-page";

const ledgerId = newId();
const account: Account = {
  id: newId(),
  ledgerId,
  name: "My card",
  type: "card",
  currency: "USD",
  openingBalance: { amount: -125050, currency: "USD" },
  inboundBonusBps: null,
  bonusCategoryId: null,
  feeCategoryId: null,
  defaultFee: null,
  contactId: null,
  balance: { amount: -125050, currency: "USD" },
  archivedAt: null,
  version: 1,
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
};
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
});
function mount(
  items: Account[],
  role = "owner",
  privacy = false,
  wrap: (children: ReactNode) => ReactNode = (children) => children,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(
      async (url) =>
        new Response(
          JSON.stringify(
            String(url).includes("/accounts")
              ? { items, nextCursor: null }
              : {
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
                },
          ),
        ),
    ),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PrivacyContext value={privacy}>{wrap(<AccountsPage />)}</PrivacyContext>
    </QueryClientProvider>,
  );
}
const bank: Account = {
  ...account,
  id: newId(),
  name: "Harbor Checking",
  type: "bank",
  openingBalance: { amount: 120000, currency: "USD" },
  balance: { amount: 120000, currency: "USD" },
};
const passbook: Account = {
  ...bank,
  id: newId(),
  name: "Old Passbook",
  type: "savings",
  openingBalance: { amount: 0, currency: "USD" },
  balance: { amount: 0, currency: "USD" },
  archivedAt: "2026-10-07T00:00:00.000Z",
};
it("offers first-account setup with one primary action", async () => {
  mount([]);
  expect(await screen.findByText("No accounts yet.")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /Add.*account/ })).toHaveLength(
    1,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Add your first account" }),
  );
  expect(
    screen.getByRole("dialog", { name: "Add account" }),
  ).toBeInTheDocument();
});
it("groups accounts like Home: Cash and banking, then Cards and loans, each only when it has one", async () => {
  mount([account, bank]);
  expect(await screen.findByText("Cash and banking")).toBeInTheDocument();
  const labels = screen
    .getAllByText(/^(Cash and banking|Cards and loans)$/)
    .map((node) => node.textContent);
  expect(labels).toEqual(["Cash and banking", "Cards and loans"]);
  cleanup();
  mount([bank]);
  expect(await screen.findByText("Cash and banking")).toBeInTheDocument();
  expect(screen.queryByText("Cards and loans")).not.toBeInTheDocument();
});
it("gives each row its type, currency and what the balance means as one hint", async () => {
  mount([account, bank]);
  expect(
    await screen.findByText("Credit card · USD · Owed"),
  ).toBeInTheDocument();
  expect(screen.getByText("Bank account · USD")).toBeInTheDocument();
  expect(screen.getByText("-$1,250.50")).toBeInTheDocument();
});
it("keeps archived accounts in a fold under the cards", async () => {
  mount([bank, passbook]);
  const summary = await screen.findByText("1 archived");
  const fold = summary.closest("details");
  expect(fold).not.toHaveAttribute("open");
  expect(fold).toContainElement(screen.getByText("Old Passbook"));
  expect(screen.getByText("Harbor Checking").closest("details")).toBeNull();
});
it("shows no fold when nothing is archived", async () => {
  mount([bank]);
  await screen.findByText("Harbor Checking");
  expect(screen.queryByText(/archived$/)).not.toBeInTheDocument();
});
it("says so when every account is archived", async () => {
  mount([passbook]);
  expect(await screen.findByText("No active accounts.")).toBeInTheDocument();
  expect(screen.getByText("1 archived")).toBeInTheDocument();
});
it("never lists a client's balance account", async () => {
  mount([bank, { ...account, id: newId(), name: "Ada", contactId: newId() }]);
  await screen.findByText("Harbor Checking");
  expect(screen.queryByText("Ada")).not.toBeInTheDocument();
});
it("removes actual balance text in privacy mode", async () => {
  mount([account], "owner", true);
  expect(await screen.findByText("My card")).toBeInTheDocument();
  expect(screen.getByText("Amount hidden")).toBeInTheDocument();
  expect(screen.queryByText("-$1,250.50")).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain("1,250");
});
it("permits viewer reads without exposing mutation controls", async () => {
  mount([account], "viewer");
  expect(await screen.findByText("-$1,250.50")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.getByText(/You can view accounts/)).toBeInTheDocument();
});
it("opens the account's sheet from its row", async () => {
  mount([bank]);
  await userEvent.click(
    await screen.findByRole("button", { name: /Harbor Checking/ }),
  );
  const sheet = screen.getByRole("dialog", { name: "Edit account" });
  expect(within(sheet).getByLabelText("Account name")).toHaveValue(
    "Harbor Checking",
  );
});
it("asks before archiving from the sheet, then says it is done", async () => {
  mount([bank]);
  await userEvent.click(
    await screen.findByRole("button", { name: /Harbor Checking/ }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Archive" }));
  const question = await screen.findByRole("dialog", {
    name: "Archive Harbor Checking?",
  });
  expect(
    within(question).getByRole("button", { name: "Cancel" }),
  ).toBeInTheDocument();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ ...bank, archivedAt: "2026-10-08T00:00:00.000Z" }),
        ),
    ),
  );
  await userEvent.click(
    within(question).getByRole("button", { name: "Archive" }),
  );
  expect(
    await screen.findByText(
      "Account archived. Its balance and history are kept.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("keeps the account when the question is cancelled", async () => {
  mount([bank]);
  await userEvent.click(
    await screen.findByRole("button", { name: /Harbor Checking/ }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  const question = await screen.findByRole("dialog", {
    name: "Delete Harbor Checking?",
  });
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  await userEvent.click(
    within(question).getByRole("button", { name: "Cancel" }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});
it("gives the phone's one Add button its label while accounts exist, and none for a viewer or an empty ledger", async () => {
  const seen: (PageAdd | null)[] = [];
  const set = (add: PageAdd | null) => void seen.push(add);
  const last = () => seen[seen.length - 1];
  const mountIn = (items: Account[], role: string) => {
    mount(items, role, false, (children) => (
      <PageAddProvider value={set}>{children}</PageAddProvider>
    ));
  };
  mountIn([bank], "owner");
  await screen.findByText("Harbor Checking");
  expect(last()).toMatchObject({ label: "Add account", disabled: false });
  cleanup();
  seen.length = 0;
  mountIn([bank], "viewer");
  await screen.findByText("Harbor Checking");
  expect(last()).toBeNull();
  cleanup();
  seen.length = 0;
  mountIn([], "owner");
  await screen.findByText("No accounts yet.");
  expect(last()).toBeNull();
});
it("loads the next page on request", async () => {
  const cursor = newId();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url) => {
      const target = String(url);
      const body = target.includes("/accounts")
        ? target.includes(`cursor=${cursor}`)
          ? { items: [passbook], nextCursor: null }
          : { items: [bank], nextCursor: cursor }
        : {
            items: [
              {
                id: ledgerId,
                name: "Personal",
                baseCurrency: "USD",
                timeZone: null,
                version: 1,
                role: "owner",
              },
            ],
          };
      return new Response(JSON.stringify(body));
    }),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AccountsPage />
    </QueryClientProvider>,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Load more accounts" }),
  );
  expect(await screen.findByText("1 archived")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Load more accounts" }),
  ).not.toBeInTheDocument();
});
it("says when the accounts cannot be loaded and tries again", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url) =>
      String(url).includes("/accounts")
        ? new Response("{}", { status: 500 })
        : new Response(
            JSON.stringify({
              items: [
                {
                  id: ledgerId,
                  name: "Personal",
                  baseCurrency: "USD",
                  timeZone: null,
                  version: 1,
                  role: "owner",
                },
              ],
            }),
          ),
    ),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AccountsPage />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText("Couldn't load your accounts."),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  expect(screen.queryByText("No accounts yet.")).not.toBeInTheDocument();
});

it("shows a foreign account in its own currency with today's value in the base currency", async () => {
  const euro: Account = {
    ...account,
    id: newId(),
    name: "Euro bank",
    type: "bank",
    currency: "EUR",
    openingBalance: { amount: 100000, currency: "EUR" },
    balance: { amount: 100000, currency: "EUR" },
  };
  const rate = {
    id: newId(),
    ledgerId,
    code: "EUR",
    date: "2026-10-09",
    rate: "1.1217",
    source: "api",
    version: 1,
    createdAt: "2026-10-09T00:00:00.000Z",
    updatedAt: "2026-10-09T00:00:00.000Z",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url) => {
      const target = String(url);
      const body = target.includes("/accounts")
        ? { items: [euro], nextCursor: null }
        : target.endsWith("/currencies")
          ? {
              baseCurrency: "USD",
              items: [
                {
                  id: newId(),
                  ledgerId,
                  code: "EUR",
                  version: 1,
                  latestRate: rate,
                  createdAt: rate.createdAt,
                  updatedAt: rate.updatedAt,
                },
              ],
            }
          : {
              items: [
                {
                  id: ledgerId,
                  name: "Personal",
                  baseCurrency: "USD",
                  timeZone: null,
                  version: 1,
                  role: "owner",
                },
              ],
            };
      return new Response(JSON.stringify(body));
    }),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PrivacyContext value={false}>
        <AccountsPage />
      </PrivacyContext>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("€1,000.00")).toBeInTheDocument();
  // The note is split across elements, so read the whole line.
  expect(
    await screen.findByText(
      (_, element) =>
        !!element?.classList.contains("base-note") &&
        element.textContent?.replace(/\s+/g, " ").trim() === "About $1,121.70",
    ),
  ).toBeInTheDocument();
});
it("shows a chevron on a row only when it opens something", async () => {
  mount([bank], "viewer");
  await screen.findByText("Harbor Checking");
  expect(document.querySelector(".ui-row-chevron")).toBeNull();
  cleanup();
  mount([bank], "owner");
  await screen.findByText("Harbor Checking");
  expect(document.querySelector(".ui-row-chevron")).not.toBeNull();
});
it("says the account is unarchived after Unarchive", async () => {
  mount([passbook]);
  await userEvent.click(
    await screen.findByRole("button", { name: /Old Passbook/ }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Unarchive" }));
  const question = await screen.findByRole("dialog", {
    name: "Unarchive Old Passbook?",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ ...passbook, archivedAt: null })),
    ),
  );
  await userEvent.click(
    within(question).getByRole("button", { name: "Unarchive" }),
  );
  expect(
    await screen.findByText(
      "Account unarchived. It is available for new entries again.",
    ),
  ).toBeInTheDocument();
});
it("locks the rows, the Add buttons and the phone's Add while a save is unconfirmed, and Resume reopens it", async () => {
  const seen: (PageAdd | null)[] = [];
  mount([bank], "owner", false, (children) => (
    <PageAddProvider value={(add) => void seen.push(add)}>
      {children}
    </PageAddProvider>
  ));
  await screen.findByText("Harbor Checking");
  expect(seen[seen.length - 1]).toMatchObject({ disabled: false });
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Connection lost")),
  );
  await userEvent.click(screen.getByRole("button", { name: "Add account" }));
  await userEvent.type(screen.getByLabelText("Account name"), "Wallet");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText(/couldn't confirm the save/);
  await userEvent.click(screen.getByRole("button", { name: "Close for now" }));
  expect(
    screen.getByRole("button", { name: /Harbor Checking/ }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Add account" })).toBeDisabled();
  expect(seen[seen.length - 1]).toMatchObject({ disabled: true });
  await userEvent.click(screen.getByRole("button", { name: "Resume action" }));
  expect(
    screen.getByRole("dialog", { name: "Add account" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Account name")).toHaveValue("Wallet");
});
