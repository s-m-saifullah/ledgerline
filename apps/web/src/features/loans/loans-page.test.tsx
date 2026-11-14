import {
  type HomeSummary,
  type LoanBalance,
  type LoanPerson,
  newId,
} from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentMonth } from "../../lib/month";
import { PrivacyContext } from "../../lib/preferences";
import { type PageAdd, PageAddProvider } from "../shell/page-add";
import { LoansPage } from "./loans-page";

const params: { personId?: string } = {};
const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params: linkParams,
    className,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    params?: { personId: string };
    className?: string;
  }) => (
    <a
      href={linkParams ? to.replace("$personId", linkParams.personId) : to}
      className={className}
      {...rest}
    >
      {children}
    </a>
  ),
  useParams: () => params,
  useNavigate: () => navigate,
}));

const ledgerId = newId();
const usd = (amount: number) => ({ amount, currency: "USD" as const });
const stamp = "2026-10-01T00:00:00.000Z";
const loan = (amount: number, currency = "USD"): LoanBalance => ({
  accountId: newId(),
  currency,
  openingBalance: { amount: 0, currency },
  balance: { amount, currency },
  version: 1,
});
const person = (
  name: string,
  balances: LoanBalance[] = [],
  archived = false,
): LoanPerson => ({
  id: newId(),
  name,
  origin: "loan",
  archivedAt: archived ? stamp : null,
  version: 1,
  balances,
});
const summary = (lent: number, borrowed: number) =>
  ({
    month: currentMonth(),
    monthStart: "2026-10-01",
    monthEnd: "2026-10-31",
    inHand: usd(0),
    netWorth: usd(0),
    liabilitiesOwed: usd(0),
    accounts: [],
    otherActive: { count: 0, balance: usd(0) },
    archived: { count: 0, balance: usd(0) },
    moneyIn: usd(0),
    moneyOut: usd(0),
    owed: {
      total: usd(0),
      personCount: 0,
      otherCurrencies: [],
      unconvertedCurrencies: [],
    },
    loans: { lent: usd(lent), borrowed: usd(borrowed) },
    pendingCount: 0,
    latest: [],
    setup: { hasActiveAccount: true, hasCategory: true },
    unconvertedCurrencies: [],
  }) as HomeSummary;

type World = {
  people: LoanPerson[];
  lent?: number;
  borrowed?: number;
  role?: "owner" | "viewer";
  peopleFail?: boolean;
  /** Pages of people: the cursor of the next one. */
  split?: boolean;
  /** What the loan accounts' entries are, for the Activity list. */
  entries?: unknown[];
  /** A person's own answer never comes, so only what the list knows can be shown. */
  contactSlow?: boolean;
  /** The next page of people is always the same one. */
  loops?: boolean;
};
let queryClient: QueryClient;
let pageAdd: PageAdd | null = null;
const asked: string[] = [];
function mount(world: World, privacy = false) {
  asked.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = String(input);
      asked.push(url);
      const json = (body: unknown) => new Response(JSON.stringify(body));
      if (url.endsWith("/ledgers"))
        return json({
          items: [
            {
              id: ledgerId,
              name: "Personal",
              role: world.role ?? "owner",
              baseCurrency: "USD",
              timeZone: "UTC",
              version: 1,
            },
          ],
        });
      if (url.includes("/home"))
        return json(summary(world.lent ?? 0, world.borrowed ?? 0));
      if (/\/loans\?/.test(url)) {
        if (world.peopleFail) return new Response("{}", { status: 500 });
        if (world.loops)
          return json({ items: world.people, nextCursor: world.people[0]?.id });
        if (world.split) {
          const second = url.includes("cursor=");
          return json({
            items: second ? world.people.slice(1) : world.people.slice(0, 1),
            nextCursor: second ? null : world.people[0]?.id,
          });
        }
        return json({ items: world.people, nextCursor: null });
      }
      const loans = /\/contacts\/([^/?]+)\/loans$/.exec(url);
      if (loans)
        return json({
          items: world.people.find((p) => p.id === loans[1])?.balances ?? [],
        });
      const one = /\/contacts\/([^/?]+)$/.exec(url);
      if (one && world.contactSlow) return new Promise<Response>(() => {});
      if (one) {
        const found = world.people.find((p) => p.id === one[1]);
        return found
          ? json({
              ...found,
              ledgerId,
              phone: null,
              email: null,
              note: null,
              createdAt: stamp,
              updatedAt: stamp,
              openBalance: usd(0),
              openBalances: [],
              unconvertedCurrencies: [],
              oldestOpenServiceDate: null,
              paidThisMonth: { base: usd(0), amounts: [] },
            })
          : new Response("{}", { status: 404 });
      }
      if (url.includes("/transactions"))
        return json({ items: world.entries ?? [], nextCursor: null });
      return new Response("{}", { status: 404 });
    }),
  );
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PageAddProvider
        value={(add) => {
          pageAdd = add;
        }}
      >
        <PrivacyContext value={privacy}>
          <LoansPage />
        </PrivacyContext>
      </PageAddProvider>
    </QueryClientProvider>,
  );
}
const rowNames = () =>
  Array.from(document.querySelectorAll(".ln-list .ui-row-title")).map(
    (el) => el.textContent,
  );
const wideBody = (width: number) =>
  Object.defineProperty(document.body, "clientWidth", {
    configurable: true,
    value: width,
  });

beforeEach(() => {
  pageAdd = null;
  delete params.personId;
  navigate.mockClear();
});
afterEach(() => {
  cleanup();
  queryClient?.clear();
  vi.unstubAllGlobals();
  wideBody(0);
});

describe("the Loans list", () => {
  it("shows People owe and You owe, each only when it is not zero", async () => {
    mount({ people: [person("Sam", [loan(5000)])], lent: 5000, borrowed: 0 });
    const card = await screen.findByRole("region", { name: "Loan totals" });
    expect(within(card).getByText("People owe")).toBeTruthy();
    expect(within(card).getByText("$50.00")).toBeTruthy();
    expect(within(card).queryByText("You owe")).toBeNull();
    cleanup();
    mount({ people: [person("Sam", [loan(-700)])], lent: 0, borrowed: 700 });
    const other = await screen.findByRole("region", { name: "Loan totals" });
    expect(within(other).getByText("You owe")).toBeTruthy();
    expect(within(other).queryByText("People owe")).toBeNull();
  });
  it("has no totals card with nothing lent or borrowed", async () => {
    mount({ people: [person("Sam")] });
    await screen.findByText("Sam");
    expect(screen.queryByRole("region", { name: "Loan totals" })).toBeNull();
  });
  it("lists people with something open first, each with one hint and its amount, as a link to its own address", async () => {
    const sam = person("Sam", [loan(5000)]);
    mount({ people: [person("Amy", [loan(0)]), sam, person("Ben")] });
    await screen.findByText("Sam");
    expect(rowNames()).toEqual(["Sam", "Amy", "Ben"]);
    const link = screen.getByRole("link", { name: /^Sam/ });
    expect(link.getAttribute("href")).toBe(`/loans/${sam.id}`);
    expect(link.id).toBe(`loan-person-${sam.id}`);
    expect(within(link).getByText("Owes you")).toBeTruthy();
    expect(within(link).getByText("$50.00")).toBeTruthy();
    expect(
      within(screen.getByRole("link", { name: /^Amy/ })).getByText("Settled"),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("link", { name: /^Ben/ })).getByText(
        "No loans yet",
      ),
    ).toBeTruthy();
  });
  it("reads every page of people", async () => {
    mount({
      people: [person("Sam", [loan(5000)]), person("Amy")],
      split: true,
    });
    await screen.findByText("Amy");
    expect(rowNames()).toEqual(["Sam", "Amy"]);
    expect(asked.some((u) => u.includes("status=all"))).toBe(true);
    expect(asked.some((u) => u.includes("limit=50"))).toBe(true);
  });
  it("shows a search box from eight people and filters by name", async () => {
    const seven = Array.from({ length: 7 }, (_, i) => person(`Pat ${i}`));
    mount({ people: seven });
    await screen.findByText("Pat 0");
    expect(screen.queryByRole("searchbox")).toBeNull();
    cleanup();
    const eight = [...seven, person("Zoe")];
    mount({ people: eight });
    await screen.findByText("Zoe");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search people" }), {
      target: { value: "zo" },
    });
    expect(rowNames()).toEqual(["Zoe"]);
  });
  it("keeps the same search box while the list narrows as someone types", async () => {
    mount({
      people: Array.from({ length: 9 }, (_, i) => person(`Pat ${i}`)),
    });
    await screen.findByText("Pat 0");
    const box = screen.getByRole("searchbox");
    fireEvent.change(box, { target: { value: "Pat 3" } });
    expect(rowNames()).toEqual(["Pat 3"]);
    expect(screen.getByRole("searchbox")).toBe(box);
    fireEvent.change(box, { target: { value: "nobody" } });
    expect(screen.getByText("No matching people.")).toBeTruthy();
    expect(screen.getByRole("searchbox")).toBe(box);
  });
  it("has Active, Archived and All only while someone is archived", async () => {
    mount({ people: [person("Sam"), person("Old", [], true)] });
    await screen.findByText("Sam");
    const chips = screen.getByRole("group", { name: "Show" });
    expect(rowNames()).toEqual(["Sam"]);
    fireEvent.click(within(chips).getByRole("button", { name: "Archived" }));
    expect(rowNames()).toEqual(["Old"]);
    fireEvent.click(within(chips).getByRole("button", { name: "All" }));
    expect(rowNames()).toEqual(["Old", "Sam"]);
    cleanup();
    mount({ people: [person("Sam")] });
    await screen.findByText("Sam");
    expect(screen.queryByRole("group", { name: "Show" })).toBeNull();
  });
  it("says there are no loans yet", async () => {
    mount({ people: [] });
    expect(await screen.findByText("No loans yet.")).toBeTruthy();
  });
  it("says it could not load people, and retries", async () => {
    mount({ people: [], peopleFail: true });
    expect(await screen.findByText("Couldn't load people.")).toBeTruthy();
  });
  it("hides amounts in privacy mode", async () => {
    mount({ people: [person("Sam", [loan(5000)])], lent: 5000 }, true);
    await screen.findByText("Sam");
    expect(screen.queryByText("$50.00")).toBeNull();
  });
});

describe("one person at /loans/{id}", () => {
  const sam = person("Sam", [loan(5000), loan(-1200, "EUR")]);
  it("shows the person's card with what is owed per currency, and the list stays", async () => {
    params.personId = sam.id;
    mount({ people: [sam, person("Amy")] });
    const card = await screen.findByRole("region", { name: "Sam" });
    expect(within(card).getByText("Open balances")).toBeTruthy();
    expect(within(card).getByText("$50.00")).toBeTruthy();
    expect(within(card).getByText("€12.00")).toBeTruthy();
    expect(rowNames()).toEqual(["Sam", "Amy"]);
    expect(document.querySelector(".ln-split")?.getAttribute("data-open")).toBe(
      "true",
    );
    expect(
      screen.getByRole("link", { name: /^Sam/ }).getAttribute("data-selected"),
    ).toBe("true");
  });
  it("has Record repayment as the one button when something is open, Lend money when nothing is", async () => {
    params.personId = sam.id;
    mount({ people: [sam] });
    expect(
      await screen.findByRole("button", { name: "Record repayment" }),
    ).toBeTruthy();
    cleanup();
    const settled = person("Ben", [loan(0)]);
    params.personId = settled.id;
    mount({ people: [settled] });
    expect(
      await screen.findByRole("button", { name: "Lend money" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Record repayment" }),
    ).toBeNull();
  });
  it("opens the first person beside the list from 1100 px when none is chosen, and none below", async () => {
    wideBody(1200);
    mount({ people: [sam, person("Amy")] });
    expect(await screen.findByRole("region", { name: "Sam" })).toBeTruthy();
    expect(document.querySelector(".ln-split")?.getAttribute("data-open")).toBe(
      "false",
    );
    cleanup();
    wideBody(800);
    mount({ people: [sam] });
    await screen.findByText("Sam");
    expect(screen.queryByRole("region", { name: "Sam" })).toBeNull();
    expect(asked.some((u) => new RegExp(`/contacts/${sam.id}`).test(u))).toBe(
      false,
    );
  });
  it("shows an archived person with the Archived label and no primary button", async () => {
    const old = person("Old", [loan(300)], true);
    params.personId = old.id;
    mount({ people: [old] });
    const card = await screen.findByRole("region", { name: "Old" });
    expect(within(card).getByText("Archived")).toBeTruthy();
    expect(
      within(card).getByRole("heading", { name: "Old (archived)" }),
    ).toBeTruthy();
    expect(
      within(card).queryByRole("button", { name: "Record repayment" }),
    ).toBeNull();
    expect(
      within(card).queryByRole("button", { name: "Lend money" }),
    ).toBeNull();
  });
  it("shows no buttons to a viewer, and no Add", async () => {
    params.personId = sam.id;
    mount({ people: [sam], role: "viewer" });
    await screen.findByRole("region", { name: "Sam" });
    expect(
      screen.queryByRole("button", { name: "Record repayment" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /^More actions/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Remove the USD loan" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^Change the balance/ }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Add loan" })).toBeNull();
    expect(pageAdd).toBeNull();
  });
  it("says it could not load a person nobody knows", async () => {
    params.personId = newId();
    mount({ people: [sam] });
    expect(await screen.findByText("Couldn't load this person.")).toBeTruthy();
  });
});

describe("the phone's one Add button", () => {
  it("adds a loan on the list and lends on a person, disabled for an archived one", async () => {
    mount({ people: [person("Sam", [loan(100)])] });
    await screen.findByText("Sam");
    await waitFor(() => expect(pageAdd?.label).toBe("Add loan"));
    expect(pageAdd?.disabled).toBe(false);
    cleanup();
    const sam = person("Sam", [loan(100)]);
    params.personId = sam.id;
    mount({ people: [sam] });
    await waitFor(() => expect(pageAdd?.label).toBe("Lend money"));
    cleanup();
    const old = person("Old", [], true);
    params.personId = old.id;
    mount({ people: [old] });
    await screen.findByRole("region", { name: "Old" });
    await waitFor(() => expect(pageAdd?.disabled).toBe(true));
  });
  it("opens the Add loan sheet", async () => {
    mount({ people: [person("Sam")] });
    await screen.findByText("Sam");
    await waitFor(() => expect(pageAdd).not.toBeNull());
    pageAdd?.onClick();
    expect(
      await screen.findByRole("dialog", { name: "Add loan" }),
    ).toBeTruthy();
  });
});

describe("the head", () => {
  it("has the h1 Loans, an Add loan button and an All people link", async () => {
    mount({ people: [person("Sam")] });
    await screen.findByText("Sam");
    expect(
      screen.getByRole("heading", { level: 1, name: "Loans" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add loan" }).id).toBe(
      "add-loan",
    );
    expect(
      screen.getByRole("link", { name: "All people" }).getAttribute("href"),
    ).toBe("/loans");
  });
});

const entry = (
  accountId: string,
  kind: "transfer" | "expense" | "income",
  amount: number,
  date: string,
) => ({
  id: newId(),
  ledgerId,
  accountId,
  categoryId: null,
  kind,
  status: "cleared",
  amount: usd(amount),
  baseAmount: usd(amount),
  fxRate: "1",
  date,
  time: null,
  payee: null,
  note: null,
  transferId: null,
  relatedTransferId: null,
  feeTransferId: null,
  tipPaymentId: null,
  splits: [],
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
});
const menuItems = () =>
  within(screen.getByRole("dialog"))
    .getAllByRole("button")
    .map((b) => b.textContent)
    .filter((t) => t !== "Cancel");

describe("Balance, Before Ledgerline and Activity", () => {
  it("has a row per currency, with Remove, and a Settled row for a loan with nothing left", async () => {
    const sam = person("Sam", [loan(5000), loan(-1200, "EUR"), loan(0, "GBP")]);
    params.personId = sam.id;
    mount({ people: [sam] });
    const region = await screen.findByRole("region", {
      name: "Balance and activity",
    });
    expect(within(region).getByText("Sam owes you")).toBeTruthy();
    expect(within(region).getByText("You owe Sam")).toBeTruthy();
    expect(within(region).getByText("Settled (GBP)")).toBeTruthy();
    expect(
      within(region).getByRole("button", { name: "Remove the USD loan" }),
    ).toBeTruthy();
    expect(
      within(region).getByRole("button", { name: "Remove the EUR loan" }),
    ).toBeTruthy();
    expect(
      within(region).getByRole("button", { name: "Remove the GBP loan" }),
    ).toBeTruthy();
    expect(within(region).queryByText("Before Ledgerline")).toBeNull();
  });
  it("shows Before Ledgerline only for a balance that is not zero, with Change", async () => {
    const before = { ...loan(100), openingBalance: usd(-2500) };
    const none = loan(100, "EUR");
    const sam = person("Sam", [before, none]);
    params.personId = sam.id;
    mount({ people: [sam] });
    const region = await screen.findByRole("region", {
      name: "Balance and activity",
    });
    const rows = within(region).getAllByText("Before Ledgerline");
    expect(rows).toHaveLength(2);
    expect(within(region).getByText("You owed")).toBeTruthy();
    expect(within(region).getByText("$25.00")).toBeTruthy();
    expect(
      within(region).getByRole("button", {
        name: "Change the balance from before Ledgerline (USD)",
      }),
    ).toBeTruthy();
    expect(
      within(region).queryByRole("button", { name: /\(EUR\)$/ }),
    ).toBeNull();
  });
  it("says nothing was lent when there are no loans", async () => {
    const sam = person("Sam");
    params.personId = sam.id;
    mount({ people: [sam] });
    expect(
      await screen.findByText("Nothing lent or borrowed yet."),
    ).toBeTruthy();
  });
  it("lists the latest entries with what each was, newest first, and links to Transactions", async () => {
    const own = loan(5000);
    const sam = person("Sam", [own]);
    params.personId = sam.id;
    mount({
      people: [sam],
      entries: [
        entry(own.accountId, "transfer", 3000, "2026-10-03"),
        entry(own.accountId, "transfer", -1000, "2026-10-09"),
        entry(own.accountId, "expense", -500, "2026-10-05"),
        entry(own.accountId, "income", 200, "2026-10-01"),
      ],
    });
    const region = await screen.findByRole("region", {
      name: "Balance and activity",
    });
    await within(region).findByText("You received");
    const titles = Array.from(region.querySelectorAll(".ui-row-title")).map(
      (e) => e.textContent,
    );
    expect(titles.slice(-4)).toEqual([
      "You received",
      "You waived",
      "You paid out",
      "They waived",
    ]);
    expect(within(region).getByText("2026-10-09")).toBeTruthy();
    expect(within(region).getByText("$10.00")).toBeTruthy();
    expect(
      within(region)
        .getByRole("link", { name: "See every entry in Transactions" })
        .getAttribute("href"),
    ).toBe("/transactions");
  });
  it("has no Activity without entries", async () => {
    const sam = person("Sam", [loan(5000)]);
    params.personId = sam.id;
    mount({ people: [sam] });
    const region = await screen.findByRole("region", {
      name: "Balance and activity",
    });
    await within(region).findByText("Sam owes you");
    expect(within(region).queryByText("Activity")).toBeNull();
    expect(within(region).queryByRole("link")).toBeNull();
  });
});

describe("the card's menu", () => {
  it("offers Lend money, Borrow money, Waive what is left, Rename and Archive while something is open", async () => {
    const sam = person("Sam", [loan(5000)]);
    params.personId = sam.id;
    mount({ people: [sam] });
    fireEvent.click(
      await screen.findByRole("button", { name: "More actions for Sam" }),
    );
    expect(menuItems()).toEqual([
      "Lend money",
      "Borrow money",
      "Waive what is left",
      "Rename",
      "Archive",
    ]);
  });
  it("offers only Borrow money, Rename and Archive when nothing is open", async () => {
    const sam = person("Sam", [loan(0)]);
    params.personId = sam.id;
    mount({ people: [sam] });
    fireEvent.click(
      await screen.findByRole("button", { name: "More actions for Sam" }),
    );
    expect(menuItems()).toEqual(["Borrow money", "Rename", "Archive"]);
  });
  it("offers only Rename and Unarchive for an archived person", async () => {
    const old = person("Old", [loan(5000)], true);
    params.personId = old.id;
    mount({ people: [old] });
    fireEvent.click(
      await screen.findByRole("button", { name: "More actions for Old" }),
    );
    expect(menuItems()).toEqual(["Rename", "Unarchive"]);
  });
  it.each([
    ["Lend money", "Lend money to Sam"],
    ["Borrow money", "Borrow money from Sam"],
    ["Waive what is left", "Waive what is left"],
    ["Rename", "Rename"],
    ["Archive", "Archive Sam?"],
  ])("%s closes the menu and opens its own editor", async (item, title) => {
    const sam = person("Sam", [loan(5000)]);
    params.personId = sam.id;
    mount({ people: [sam] });
    fireEvent.click(
      await screen.findByRole("button", { name: "More actions for Sam" }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: item }),
    );
    expect(await screen.findByRole("dialog", { name: title })).toBeTruthy();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
  it("opens Unarchive's question for an archived person", async () => {
    const old = person("Old", [], true);
    params.personId = old.id;
    mount({ people: [old] });
    fireEvent.click(
      await screen.findByRole("button", { name: "More actions for Old" }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Unarchive",
      }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Unarchive Old?" }),
    ).toBeTruthy();
  });
});

describe("the editors from the card", () => {
  it("opens Record repayment from the primary button and Remove and Change from their rows", async () => {
    const own = { ...loan(5000), openingBalance: usd(1000) };
    const sam = person("Sam", [own]);
    params.personId = sam.id;
    mount({ people: [sam] });
    fireEvent.click(
      await screen.findByRole("button", { name: "Record repayment" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Record a repayment" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(
      screen.getByRole("button", { name: "Remove the USD loan" }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: /Remove the USD loan\?|cannot be removed yet/,
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Keep loan|Close/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(
      screen.getByRole("button", {
        name: "Change the balance from before Ledgerline (USD)",
      }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: "Change the balance from before Ledgerline",
      }),
    ).toBeTruthy();
  });
  it("waits while an editor is open: the card's buttons are disabled", async () => {
    const sam = person("Sam", [loan(5000)]);
    params.personId = sam.id;
    mount({ people: [sam] });
    fireEvent.click(
      await screen.findByRole("button", { name: "Record repayment" }),
    );
    await screen.findByRole("dialog");
    expect(pageAdd?.disabled).toBe(true);
    expect(
      screen.getByRole("button", { name: "Add loan", hidden: true }),
    ).toBeDisabled();
  });
});

describe("what the list knows is shown while the rest loads", () => {
  it("draws an archived person from the list before their own answer comes", async () => {
    const old = person("Old", [loan(500)], true);
    params.personId = old.id;
    mount({ people: [old], contactSlow: true });
    const card = await screen.findByRole("region", { name: "Old" });
    expect(within(card).getByText("Archived")).toBeTruthy();
    expect(
      within(card).queryByRole("button", { name: "Record repayment" }),
    ).toBeNull();
  });
  it("says it could not load people when the pages never end", async () => {
    mount({ people: [person("Sam")], loops: true });
    expect(await screen.findByText("Couldn't load people.")).toBeTruthy();
  });
  it("shows only the latest eight entries", async () => {
    const own = loan(5000);
    const sam = person("Sam", [own]);
    params.personId = sam.id;
    mount({
      people: [sam],
      entries: Array.from({ length: 10 }, (_, i) =>
        entry(
          own.accountId,
          "transfer",
          100 + i,
          `2026-10-${String(10 + i).padStart(2, "0")}`,
        ),
      ),
    });
    const region = await screen.findByRole("region", {
      name: "Balance and activity",
    });
    await within(region)
      .findByText("You paid out", {}, { timeout: 3000 })
      .catch(() => undefined);
    await waitFor(() =>
      expect(within(region).getAllByText(/^You paid out$/)).toHaveLength(8),
    );
    expect(within(region).getByText("2026-10-19")).toBeTruthy();
    expect(within(region).queryByText("2026-10-11")).toBeNull();
  });
});
