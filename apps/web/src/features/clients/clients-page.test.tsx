import { type Contact, newId, type Receivable } from "@ledgerline/shared";
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
import { ClientsPage } from "./clients-page";
import { paidInLabel } from "./model";

const params: { clientId?: string } = {};
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
    params?: { clientId: string };
    className?: string;
  }) => (
    <a
      href={linkParams ? to.replace("$clientId", linkParams.clientId) : to}
      className={className}
      {...rest}
    >
      {children}
    </a>
  ),
  useParams: () => params,
  useNavigate: () => navigate,
}));
const open = vi.fn();
const workspace = {
  blocked: false,
  deletedClientId: null as string | null,
  open,
};
vi.mock("./workspace", () => ({ useClientsWorkspace: () => workspace }));

const ledgerId = newId();
const usd = (amount: number) => ({ amount, currency: "USD" as const });
const stamp = "2026-10-01T00:00:00.000Z";
const person = (name: string, over: Partial<Contact> = {}): Contact => ({
  id: newId(),
  ledgerId,
  name,
  phone: null,
  email: null,
  note: null,
  origin: "client",
  archivedAt: null,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
  openBalance: usd(0),
  openBalances: [],
  unconvertedCurrencies: [],
  oldestOpenServiceDate: null,
  paidThisMonth: { base: usd(0), amounts: [] },
  ...over,
});
const owing = (name: string, cents: number, over: Partial<Contact> = {}) =>
  person(name, {
    openBalance: usd(cents),
    openBalances: [usd(cents)],
    oldestOpenServiceDate: "2026-10-16",
    ...over,
  });
const serviceOf = (
  contact: Contact,
  description: string,
  over: Partial<Receivable> = {},
): Receivable => ({
  id: newId(),
  ledgerId,
  contactId: contact.id,
  description,
  serviceDate: "2026-10-07",
  serviceTime: null,
  dueDate: null,
  amount: usd(10000),
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
  received: usd(0),
  remaining: usd(10000),
  outstanding: usd(10000),
  status: "unpaid",
  writtenOffAt: null,
  writtenOffAmount: null,
  writeOffReason: null,
  ...over,
});

const paymentOf = (
  s: Receivable,
  over: { receiptId?: string | null; note?: string | null } = {},
) => ({
  id: newId(),
  ledgerId,
  receivableId: s.id,
  transactionId: newId(),
  amount: usd(4000),
  receiptId: over.receiptId ?? null,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
  tip: null,
  transaction: {
    id: newId(),
    ledgerId,
    accountId: newId(),
    categoryId: newId(),
    kind: "income",
    date: "2026-10-27",
    time: null,
    amount: usd(4000),
    status: "cleared",
    payee: "Sam",
    note: over.note ?? null,
    fxRate: "1.0000000000",
    baseAmount: usd(4000),
    transferId: null,
    relatedTransferId: null,
    feeTransferId: null,
    tipPaymentId: null,
    receivablePaymentId: null,
    receivableId: s.id,
    isSplit: false,
    splits: [],
    tags: [],
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
  },
  receivable: s,
});

type World = {
  clients: Contact[];
  services: Record<string, Receivable[]>;
  role?: "owner" | "viewer";
  clientsFail?: boolean;
  /** More history than one page, so its count is not yet known. */
  historyNext?: boolean;
  /** Payments by service id. */
  payments?: Record<string, unknown[]>;
};
let queryClient: QueryClient;
/** What the page last told the shell its one Add button does. */
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
      if (url.includes("/ledgers/") === false && url.endsWith("/ledgers"))
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
      if (/\/contacts\?/.test(url))
        return world.clientsFail
          ? new Response("{}", { status: 500 })
          : json({ items: world.clients, nextCursor: null });
      const one = /\/contacts\/([^/?]+)(\?|$)/.exec(url);
      if (one) {
        const found = world.clients.find((c) => c.id === one[1]);
        return found ? json(found) : new Response("{}", { status: 404 });
      }
      if (/\/contacts\/[^/]+\/history/.test(url))
        return json({
          items: [],
          nextCursor: world.historyNext ? newId() : null,
        });
      const list = /\/receivables\?.*contactId=([^&]+)/.exec(url);
      if (list)
        return json({
          items: world.services[list[1] as string] ?? [],
          nextCursor: null,
        });
      const pays = /\/receivables\/([^/]+)\/payments/.exec(url);
      if (pays)
        return json({
          items: world.payments?.[pays[1] as string] ?? [],
          nextCursor: null,
        });
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
          <ClientsPage />
        </PrivacyContext>
      </PageAddProvider>
    </QueryClientProvider>,
  );
}
/** An element whose own text, with the amounts inside it, reads as given. */
const aboutText = (pattern: RegExp) => (_: string, el: Element | null) =>
  !!el?.classList.contains("cl-about") && pattern.test(el.textContent ?? "");
const rowNames = () =>
  Array.from(document.querySelectorAll(".cl-list .ui-row-title")).map(
    (el) => el.textContent,
  );

beforeEach(() => {
  pageAdd = null;
  delete params.clientId;
  workspace.blocked = false;
  workspace.deletedClientId = null;
  open.mockClear();
  navigate.mockClear();
});
afterEach(() => {
  cleanup();
  queryClient?.clear();
  vi.unstubAllGlobals();
  Object.defineProperty(document.body, "clientWidth", {
    configurable: true,
    value: 0,
  });
});

describe("the Clients list", () => {
  it("shows what clients owe, how many, and the most owed first", async () => {
    mount({
      clients: [owing("Small", 10000), person("Quiet"), owing("Big", 190000)],
      services: {},
    });
    expect(await screen.findByText("Big")).toBeTruthy();
    const total = screen.getByRole("region", { name: "Clients owe" });
    expect(within(total).getByText("$2,000.00")).toBeTruthy();
    expect(within(total).getByText("2 clients")).toBeTruthy();
    // Open is the chip in use while someone owes, so the settled client is not listed.
    expect(rowNames()).toEqual(["Big", "Small"]);
    expect(
      screen.getByRole("button", { name: /Open/ }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("gives a row one hint and the balance, and Settled for one who owes nothing", async () => {
    mount({
      clients: [owing("Big", 190000), person("Quiet")],
      services: {},
    });
    await screen.findByText("Big");
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(
      screen.getByText(/^Oldest unpaid (\d+d ago|today) · Oct 16$/),
    ).toBeTruthy();
    const list = document.querySelector(
      ".cl-list .ui-card.ui-list",
    ) as HTMLElement;
    expect(within(list).getByText("$1,900.00")).toBeTruthy();
    expect(within(list).getByText("Settled")).toBeTruthy();
  });

  it("moves between Open, Settled and All, and counts the first two", async () => {
    mount({
      clients: [owing("Big", 190000), person("Quiet"), person("Calm")],
      services: {},
    });
    await screen.findByText("Big");
    expect(screen.getByRole("button", { name: "Open 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Settled 2" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Settled 2" }));
    expect(rowNames()).toEqual(["Calm", "Quiet"]);
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(rowNames()).toEqual(["Big", "Calm", "Quiet"]);
  });

  it("offers Archived only when someone is archived", async () => {
    const gone = person("Gone", { archivedAt: stamp });
    mount({ clients: [owing("Big", 100), gone], services: {} });
    await screen.findByText("Big");
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(rowNames()).toEqual(["Gone"]);
    expect(
      screen.getByText("Archived", { selector: ".ui-row-hint" }),
    ).toBeTruthy();
  });

  it("has no Archived chip when nobody is archived", async () => {
    mount({ clients: [owing("Big", 100)], services: {} });
    await screen.findByText("Big");
    expect(screen.queryByRole("button", { name: "Archived" })).toBeNull();
  });

  it("searches the names as you type and says so when nothing matches", async () => {
    mount({
      clients: [owing("Acme Studio", 100), owing("Fjord", 200)],
      services: {},
    });
    await screen.findByText("Fjord");
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search clients" }),
      {
        target: { value: "acme" },
      },
    );
    expect(rowNames()).toEqual(["Acme Studio"]);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search clients" }),
      {
        target: { value: "zzz" },
      },
    );
    expect(screen.getByText("No clients here.")).toBeTruthy();
  });

  it("starts an empty ledger with the one Add client of the page head", async () => {
    mount({ clients: [], services: {} });
    expect(await screen.findByText("No clients yet.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Clients owe" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add client" }));
    expect(open).toHaveBeenCalledWith({ kind: "contact" }, "add-client");
  });

  it("gives a viewer no Add client", async () => {
    mount({ clients: [], services: {}, role: "viewer" });
    await screen.findByText("No clients yet.");
    expect(screen.queryByRole("button", { name: "Add client" })).toBeNull();
  });

  it("shows each currency owed and its dollar worth in the row", async () => {
    mount({
      clients: [
        person("Euro client", {
          openBalance: usd(64000),
          openBalances: [{ amount: 80000, currency: "EUR" }],
          oldestOpenServiceDate: "2026-10-16",
        }),
      ],
      services: {},
    });
    await screen.findByText("Euro client");
    expect(screen.getByText("€800.00")).toBeTruthy();
    expect(screen.getByText(aboutText(/^About \$640\.00$/))).toBeTruthy();
  });

  it("notes a currency with no rate, not counting it in the total", async () => {
    mount({
      clients: [
        person("Yen client", {
          openBalance: usd(0),
          openBalances: [{ amount: 5000, currency: "JPY" }],
          unconvertedCurrencies: ["JPY"],
        }),
      ],
      services: {},
    });
    await screen.findByText("Yen client");
    expect(screen.getByText(/Not counting JPY yet/)).toBeTruthy();
  });

  it("shows an error with a way to try again", async () => {
    mount({ clients: [], services: {}, clientsFail: true });
    expect(await screen.findByText("Couldn't load clients.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("hides every figure in privacy mode", async () => {
    mount({ clients: [owing("Big", 190000)], services: {} }, true);
    await screen.findByText("Big");
    expect(document.body.textContent).not.toMatch(/\$/);
  });

  it("asks for this month's figure", async () => {
    mount({ clients: [owing("Big", 100)], services: {} });
    await screen.findByText("Big");
    expect(
      asked.some(
        (url) =>
          /\/contacts\?/.test(url) &&
          url.includes(`month=${currentMonth()}`) &&
          url.includes("kind=clients"),
      ),
    ).toBe(true);
  });
});

describe("the address", () => {
  it("shows the list with no pane open, and fetches no client, on a narrow page", async () => {
    mount({ clients: [owing("Big", 100)], services: {} });
    await screen.findByText("Big");
    expect(document.querySelector(".cl-split")?.getAttribute("data-open")).toBe(
      "false",
    );
    expect(asked.some((url) => url.includes("/receivables"))).toBe(false);
    expect(screen.queryByRole("region", { name: "Big" })).toBeNull();
  });

  it("opens the first client beside the list on a wide page", async () => {
    Object.defineProperty(document.body, "clientWidth", {
      configurable: true,
      value: 1300,
    });
    mount({
      clients: [owing("Small", 100), owing("Big", 9000)],
      services: {},
    });
    expect(await screen.findByRole("region", { name: "Big" })).toBeTruthy();
    expect(document.querySelector(".cl-split")?.getAttribute("data-open")).toBe(
      "false",
    );
    expect(
      document.querySelector('.cl-row[data-selected="true"]')?.textContent,
    ).toContain("Big");
  });

  it("opens the client in the address and keeps the list mounted", async () => {
    const small = owing("Small", 100);
    params.clientId = small.id;
    mount({ clients: [small, owing("Big", 9000)], services: {} });
    expect(await screen.findByRole("region", { name: "Small" })).toBeTruthy();
    expect(document.querySelector(".cl-split")?.getAttribute("data-open")).toBe(
      "true",
    );
    expect(screen.getByText("Big")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Big/ }).getAttribute("href"),
    ).toMatch(/^\/clients\/.+/);
  });

  it("leaves a client's address once that client is deleted", async () => {
    const small = owing("Small", 100);
    params.clientId = small.id;
    workspace.deletedClientId = small.id;
    mount({ clients: [small], services: {} });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/clients" }),
    );
  });

  it("does not leave when another client was deleted", async () => {
    const small = owing("Small", 100);
    params.clientId = small.id;
    workspace.deletedClientId = "someone-else";
    mount({ clients: [small], services: {} });
    await screen.findByRole("region", { name: "Small" });
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("a client's card", () => {
  const month = currentMonth();
  it("shows who owes, what was paid this month, and the actions", async () => {
    const sam = owing("Sam", 190000, {
      email: "sam@example.com",
      phone: "+1 555 0100",
      paidThisMonth: { base: usd(50000), amounts: [usd(50000)] },
    });
    params.clientId = sam.id;
    mount({ clients: [sam], services: {} });
    const card = await screen.findByRole("region", { name: "Sam" });
    expect(within(card).getByText("Owes you")).toBeTruthy();
    expect(within(card).getByText("$1,900.00")).toBeTruthy();
    expect(within(card).getByText(paidInLabel(month))).toBeTruthy();
    expect(within(card).getByText("$500.00")).toBeTruthy();
    expect(
      within(card).getByText("sam@example.com · +1 555 0100"),
    ).toBeTruthy();
    expect(
      within(card).getByRole("button", { name: "Record payment" }),
    ).toBeTruthy();
    expect(
      within(card).getByRole("button", { name: "Log service" }),
    ).toBeTruthy();
    expect(
      within(card).getByRole("button", { name: "More actions for Sam" }),
    ).toBeTruthy();
  });

  it("asks for the figure of the month it names", async () => {
    const sam = owing("Sam", 100);
    params.clientId = sam.id;
    mount({ clients: [sam], services: {} });
    await screen.findByRole("region", { name: "Sam" });
    await waitFor(() =>
      expect(
        asked.some((u) => u.includes(`/contacts/${sam.id}?month=${month}`)),
      ).toBe(true),
    );
  });

  it("says Settled and has no Record payment when nothing is owed", async () => {
    const sam = person("Sam");
    params.clientId = sam.id;
    mount({ clients: [sam], services: {} });
    const card = await screen.findByRole("region", { name: "Sam" });
    expect(within(card).getByText("Settled")).toBeTruthy();
    expect(
      within(card).queryByRole("button", { name: "Record payment" }),
    ).toBeNull();
  });

  it("names a service that is overdue, and keeps the line's place when none is", async () => {
    const sam = owing("Sam", 100);
    params.clientId = sam.id;
    mount({
      clients: [sam],
      services: {
        [sam.id]: [serviceOf(sam, "Late work", { dueDate: "2020-01-01" })],
      },
    });
    expect(await screen.findByText("1 service overdue")).toBeTruthy();
  });

  it("keeps the overdue line's height with nothing overdue", async () => {
    const sam = owing("Sam", 100);
    params.clientId = sam.id;
    mount({ clients: [sam], services: { [sam.id]: [serviceOf(sam, "Work")] } });
    await screen.findByText("Work");
    const line = document.querySelector(".cl-overdue");
    expect(line).not.toBeNull();
    expect(line?.textContent).toBe(" ");
  });

  it("says the dollar worth and a currency with no rate on the card", async () => {
    const sam = person("Sam", {
      openBalance: usd(64000),
      openBalances: [
        { amount: 80000, currency: "EUR" },
        { amount: 5000, currency: "JPY" },
      ],
      unconvertedCurrencies: ["JPY"],
    });
    params.clientId = sam.id;
    mount({ clients: [sam], services: {} });
    const card = await screen.findByRole("region", { name: "Sam" });
    expect(
      within(card).getByText(
        aboutText(
          /^About \$640\.00 at today's rates, not counting JPY \(no rate yet\)$/,
        ),
      ),
    ).toBeTruthy();
  });

  it("gives a viewer no actions and an archived client no Log service", async () => {
    const sam = owing("Sam", 100);
    params.clientId = sam.id;
    const view = mount({ clients: [sam], services: {}, role: "viewer" });
    const card = await screen.findByRole("region", { name: "Sam" });
    expect(within(card).queryAllByRole("button")).toHaveLength(0);
    view.unmount();
    cleanup();
    const gone = owing("Gone", 100, { archivedAt: stamp });
    params.clientId = gone.id;
    mount({ clients: [gone], services: {} });
    const archived = await screen.findByRole("region", { name: "Gone" });
    expect(
      (
        within(archived).getByRole("button", {
          name: "Log service",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("asks the editor for a client payment and a new service", async () => {
    const sam = owing("Sam", 100);
    params.clientId = sam.id;
    mount({ clients: [sam], services: {} });
    const card = await screen.findByRole("region", { name: "Sam" });
    fireEvent.click(
      within(card).getByRole("button", { name: "Record payment" }),
    );
    expect(open).toHaveBeenLastCalledWith(
      { kind: "receipt", client: expect.objectContaining({ id: sam.id }) },
      "record-client-payment",
    );
    fireEvent.click(within(card).getByRole("button", { name: "Log service" }));
    expect(open).toHaveBeenLastCalledWith(
      { kind: "service", client: expect.objectContaining({ id: sam.id }) },
      "log-service",
    );
  });

  it("holds Edit, Archive and Delete in a menu sheet, Delete last and in red", async () => {
    const sam = owing("Sam", 100);
    params.clientId = sam.id;
    mount({ clients: [sam], services: {} });
    const card = await screen.findByRole("region", { name: "Sam" });
    fireEvent.click(
      within(card).getByRole("button", { name: "More actions for Sam" }),
    );
    const sheet = await screen.findByRole("dialog", { name: "Sam" });
    const items = within(sheet)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(items.filter((t) => t !== "Cancel")).toEqual([
      "Edit client",
      "Archive client",
      "Delete client",
    ]);
    expect(within(sheet).getByText("Delete client").className).toContain(
      "cl-danger",
    );
    fireEvent.click(within(sheet).getByText("Archive client"));
    expect(open).toHaveBeenLastCalledWith(
      {
        kind: "action",
        action: "archive",
        client: expect.objectContaining({ id: sam.id }),
      },
      "client-menu",
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("offers Unarchive for an archived client", async () => {
    const gone = owing("Gone", 100, { archivedAt: stamp });
    params.clientId = gone.id;
    mount({ clients: [gone], services: {} });
    const card = await screen.findByRole("region", { name: "Gone" });
    fireEvent.click(
      within(card).getByRole("button", { name: "More actions for Gone" }),
    );
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Unarchive client")).toBeTruthy();
  });

  it("blocks every action while another action is open", async () => {
    workspace.blocked = true;
    const sam = owing("Sam", 100);
    params.clientId = sam.id;
    mount({ clients: [sam], services: {} });
    const card = await screen.findByRole("region", { name: "Sam" });
    for (const name of ["Record payment", "Log service"])
      expect(
        (within(card).getByRole("button", { name }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
  });
});

describe("a client's services", () => {
  const sam = owing("Sam", 100);
  const today = new Date().toISOString().slice(0, 10);
  const unpaid = serviceOf(sam, "Website work", { dueDate: "2020-01-01" });
  const paid = serviceOf(sam, "Logo", {
    amount: usd(20000),
    received: usd(20000),
    remaining: usd(0),
    outstanding: usd(0),
    status: "paid",
  });
  const written = serviceOf(sam, "Lost cause", {
    amount: usd(5000),
    outstanding: usd(0),
    status: "writtenOff",
    writtenOffAmount: usd(5000),
    writtenOffAt: stamp,
  });
  const mountSam = (role: "owner" | "viewer" = "owner") => {
    params.clientId = sam.id;
    mount({
      clients: [sam],
      services: { [sam.id]: [unpaid, paid, written] },
      role,
    });
  };

  it("pins the unpaid ones, then Paid holds finished and written-off ones", async () => {
    mountSam();
    const unpaidList = await screen.findByRole("region", {
      name: "Unpaid services",
    });
    expect(within(unpaidList).getByText("Website work")).toBeTruthy();
    expect(within(unpaidList).getByText("Overdue")).toBeTruthy();
    expect(within(unpaidList).queryByText("Logo")).toBeNull();
    expect(screen.getByRole("radio", { name: "Paid 2" })).toBeTruthy();
    expect(screen.getByText("Logo")).toBeTruthy();
    expect(screen.getByText("Lost cause")).toBeTruthy();
    expect(
      screen.getByText("Written off", { selector: ".ui-pill" }),
    ).toBeTruthy();
    void today;
  });

  it("shows what is left on an open service and the full amount on a finished one", async () => {
    const part = serviceOf(sam, "Half done", {
      amount: usd(10000),
      received: usd(4000),
      outstanding: usd(6000),
      status: "partlyPaid",
    });
    params.clientId = sam.id;
    mount({ clients: [sam], services: { [sam.id]: [part, paid] } });
    const row = (await screen.findByText("Half done")).closest(
      ".ui-row",
    ) as HTMLElement;
    expect(within(row).getByText("$60.00")).toBeTruthy();
    expect(within(row).getByText("Partly paid")).toBeTruthy();
    const done = screen.getByText("Logo").closest(".ui-row") as HTMLElement;
    expect(within(done).getByText("$200.00")).toBeTruthy();
  });

  it("says so when there are no services, and the card's Log service is the one way to add", async () => {
    params.clientId = sam.id;
    mount({ clients: [sam], services: {} });
    expect(await screen.findByText("No services yet.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Log service" })).toHaveLength(
      1,
    );
  });

  it("says Nothing paid yet when only unpaid services exist", async () => {
    params.clientId = sam.id;
    mount({ clients: [sam], services: { [sam.id]: [unpaid] } });
    expect(await screen.findByText("Nothing paid yet.")).toBeTruthy();
  });

  it("counts the history once all of it is here", async () => {
    mountSam();
    await screen.findByText("Website work");
    expect(
      await screen.findByRole("radio", { name: "History 0" }),
    ).toBeTruthy();
  });

  it("switches to History", async () => {
    mountSam();
    await screen.findByText("Website work");
    fireEvent.click(screen.getByRole("radio", { name: /^History/ }));
    expect(
      await screen.findByRole("region", { name: "Client history" }),
    ).toBeTruthy();
  });

  it("opens a service in a sheet that names its actions", async () => {
    mountSam();
    fireEvent.click(await screen.findByText("Website work"));
    const sheet = await screen.findByRole("dialog", { name: "Website work" });
    expect(
      await within(sheet).findByText("No received payments."),
    ).toBeTruthy();
    const names = within(sheet)
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((t) => t !== "Cancel");
    expect(names).toEqual([
      "Record payment",
      "Edit service",
      "Write off remainder",
      "Delete service",
    ]);
    expect(within(sheet).getByText("Delete service").className).toContain(
      "cl-danger",
    );
  });

  it("closes the sheet and asks the editor for the action chosen", async () => {
    mountSam();
    fireEvent.click(await screen.findByText("Website work"));
    const sheet = await screen.findByRole("dialog", { name: "Website work" });
    fireEvent.click(within(sheet).getByText("Record payment"));
    expect(open).toHaveBeenLastCalledWith(
      { kind: "payment", service: expect.objectContaining({ id: unpaid.id }) },
      `service-${unpaid.id}`,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("offers Reopen instead of Edit and Write off for a written-off service", async () => {
    mountSam();
    fireEvent.click(await screen.findByText("Lost cause"));
    const sheet = await screen.findByRole("dialog", { name: "Lost cause" });
    const names = within(sheet)
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((t) => t !== "Cancel");
    expect(names).toEqual(["Reopen service", "Delete service"]);
  });

  it("has no Record payment or Write off on a paid service", async () => {
    mountSam();
    fireEvent.click(await screen.findByText("Logo"));
    const sheet = await screen.findByRole("dialog", { name: "Logo" });
    const names = within(sheet)
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((t) => t !== "Cancel");
    expect(names).toEqual(["Edit service", "Delete service"]);
  });

  it("lets a viewer read a service but not act on it", async () => {
    mountSam("viewer");
    fireEvent.click(await screen.findByText("Website work"));
    const sheet = await screen.findByRole("dialog", { name: "Website work" });
    const names = within(sheet)
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((t) => t !== "Cancel");
    expect(names).toEqual([]);
  });

  it("does not count the history while more of it is to come", async () => {
    params.clientId = sam.id;
    mount({
      clients: [sam],
      services: { [sam.id]: [unpaid] },
      historyNext: true,
    });
    await screen.findByText("Website work");
    const radio = await screen.findByRole("radio", { name: /^History/ });
    await waitFor(() =>
      expect(asked.some((u) => u.includes("/history"))).toBe(true),
    );
    expect(radio.textContent).toBe("History");
  });

  it("has no Unpaid section once everything is paid", async () => {
    params.clientId = sam.id;
    mount({ clients: [sam], services: { [sam.id]: [paid] } });
    await screen.findByText("Logo");
    expect(
      screen.queryByRole("region", { name: "Unpaid services" }),
    ).toBeNull();
  });

  it("lets a writer change a payment, but not one on a written-off service", async () => {
    const open1 = serviceOf(sam, "Open work", { status: "partlyPaid" });
    params.clientId = sam.id;
    mount({
      clients: [sam],
      services: { [sam.id]: [open1, written] },
      payments: {
        [open1.id]: [paymentOf(open1)],
        [written.id]: [paymentOf(written)],
      },
    });
    fireEvent.click(await screen.findByText("Open work"));
    let sheet = await screen.findByRole("dialog", { name: "Open work" });
    expect(await within(sheet).findByText("Edit payment")).toBeTruthy();
    expect(within(sheet).getByText("Delete payment")).toBeTruthy();
    fireEvent.click(within(sheet).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByText("Lost cause"));
    sheet = await screen.findByRole("dialog", { name: "Lost cause" });
    expect(await within(sheet).findByText("Edit payment")).toBeTruthy();
    expect(within(sheet).queryByText("Delete payment")).toBeNull();
  });

  it("shows a viewer Payment details and no way to delete", async () => {
    const open1 = serviceOf(sam, "Open work", { status: "partlyPaid" });
    params.clientId = sam.id;
    mount({
      clients: [sam],
      services: { [sam.id]: [open1] },
      payments: { [open1.id]: [paymentOf(open1)] },
      role: "viewer",
    });
    fireEvent.click(await screen.findByText("Open work"));
    const sheet = await screen.findByRole("dialog", { name: "Open work" });
    expect(await within(sheet).findByText("Payment details")).toBeTruthy();
    expect(within(sheet).queryByText("Delete payment")).toBeNull();
  });

  it("edits and deletes a payment that covered several services as a receipt", async () => {
    const open1 = serviceOf(sam, "Open work", { status: "partlyPaid" });
    const receiptId = newId();
    params.clientId = sam.id;
    mount({
      clients: [sam],
      services: { [sam.id]: [open1] },
      payments: { [open1.id]: [paymentOf(open1, { receiptId })] },
    });
    fireEvent.click(await screen.findByText("Open work"));
    const sheet = await screen.findByRole("dialog", { name: "Open work" });
    expect(await within(sheet).findByText("Edit receipt")).toBeTruthy();
    expect(within(sheet).queryByText("Edit payment")).toBeNull();
    expect(
      within(sheet).getByText("Part of one payment across several services"),
    ).toBeTruthy();
    fireEvent.click(within(sheet).getByText("Edit receipt"));
    expect(open).toHaveBeenLastCalledWith(
      {
        kind: "receipt",
        client: expect.objectContaining({ id: sam.id }),
        receiptId,
      },
      `service-${open1.id}`,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByText("Open work"));
    const again = await screen.findByRole("dialog", { name: "Open work" });
    fireEvent.click(await within(again).findByText("Delete receipt"));
    expect(open).toHaveBeenLastCalledWith(
      { kind: "action", action: "deleteReceipt", receiptId },
      `service-${open1.id}`,
    );
  });
});

describe("the one Add button of a phone", () => {
  it("adds a client on the list and says so", async () => {
    mount({ clients: [owing("Big", 100)], services: {} });
    await screen.findByText("Big");
    await waitFor(() => expect(pageAdd?.label).toBe("Add client"));
    expect(pageAdd?.disabled).toBe(false);
    pageAdd?.onClick();
    expect(open).toHaveBeenLastCalledWith({ kind: "contact" }, "add-client");
  });

  it("logs a service on a client, and not for an archived one or while another action is open", async () => {
    const sam = owing("Sam", 100);
    params.clientId = sam.id;
    mount({ clients: [sam], services: {} });
    await screen.findByRole("region", { name: "Sam" });
    await waitFor(() => expect(pageAdd?.label).toBe("Log service"));
    await waitFor(() => expect(pageAdd?.disabled).toBe(false));
    pageAdd?.onClick();
    expect(open).toHaveBeenLastCalledWith(
      { kind: "service", client: expect.objectContaining({ id: sam.id }) },
      "mobile-add-page",
    );
    cleanup();
    const gone = owing("Gone", 100, { archivedAt: stamp });
    params.clientId = gone.id;
    mount({ clients: [gone], services: {} });
    await waitFor(() => expect(pageAdd?.label).toBe("Log service"));
    await waitFor(() => expect(pageAdd?.disabled).toBe(true));
    cleanup();
    workspace.blocked = true;
    params.clientId = sam.id;
    mount({ clients: [sam], services: {} });
    await waitFor(() => expect(pageAdd?.label).toBe("Log service"));
    expect(pageAdd?.disabled).toBe(true);
  });

  it("leaves the button to the shell for a viewer", async () => {
    mount({ clients: [owing("Big", 100)], services: {}, role: "viewer" });
    await screen.findByText("Big");
    expect(pageAdd).toBeNull();
  });
});
