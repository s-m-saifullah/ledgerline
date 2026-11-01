import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";
import { setTheme } from "./theme";

// Clients in a real browser (ADR 0047, PR 10a), against the approved prototype: jsdom cannot run container
// queries, so one pane or two, the Add button of each width, the card, the rows, and the sheet against the
// drawer are measured here. The clients are mocked, so the shared owner's ledger is never changed.
const { env, pool } = connectLocalDatabase("Clients layout browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E clients layout ledger");
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic clients layout ledger",
    forwarded: [226, 22],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E clients layout ledger%'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

const usd = (amount: number) => ({ amount, currency: "USD" });
const uuid = (n: number) =>
  `01a18000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const stamp = "2026-10-01T00:00:00.000Z";
const person = (n: number, name: string, over: object = {}) => ({
  id: uuid(n),
  ledgerId: uuid(1),
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
const ACME = uuid(10);
const FJORD = uuid(11);
const EURO = uuid(12);
const LONG_NAME = `Euro client ${"with a very long name ".repeat(4)}`.trim();
const clients = [
  person(10, "Acme Studio", {
    email: "hello@acme.example",
    phone: "+1 555 0100",
    openBalance: usd(190000),
    openBalances: [usd(190000)],
    oldestOpenServiceDate: "2026-10-16",
    paidThisMonth: { base: usd(50000), amounts: [usd(50000)] },
  }),
  person(11, "Fjord & Co", {
    openBalance: usd(90000),
    openBalances: [usd(90000)],
    oldestOpenServiceDate: "2026-10-25",
  }),
  person(12, LONG_NAME, {
    openBalance: usd(64000),
    openBalances: [{ amount: 80000, currency: "EUR" }],
    oldestOpenServiceDate: "2026-10-20",
  }),
  person(13, "Lumen Labs"),
  person(14, "Old Friends", { archivedAt: stamp }),
];
const service = (
  n: number,
  contact: string,
  description: string,
  amount: number,
  received: number,
  status: string,
  over: object = {},
) => ({
  id: uuid(n),
  ledgerId: uuid(1),
  contactId: contact,
  description,
  serviceDate: "2026-10-07",
  serviceTime: null,
  dueDate: null,
  amount: usd(amount),
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
  received: usd(received),
  remaining: usd(status === "writtenOff" ? 0 : amount - received),
  outstanding: usd(status === "writtenOff" ? 0 : amount - received),
  status,
  writtenOffAt: null,
  writtenOffAmount: null,
  writeOffReason: null,
  ...over,
});
const services: Record<string, ReturnType<typeof service>[]> = {
  [ACME]: [
    service(100, ACME, "Brand refresh, phase 2", 160000, 0, "unpaid", {
      dueDate: "2020-01-01",
    }),
    service(101, ACME, "Landing page copy", 30000, 10000, "partlyPaid"),
    service(102, ACME, "Logo", 20000, 20000, "paid"),
    service(103, ACME, "Old audit", 5000, 0, "writtenOff", {
      writtenOffAmount: usd(5000),
      writtenOffAt: stamp,
    }),
  ],
  [FJORD]: [service(110, FJORD, "Quarterly report", 90000, 0, "unpaid")],
  [EURO]: [service(120, EURO, "Translation", 80000, 0, "unpaid")],
};
const payment = {
  id: uuid(301),
  ledgerId: uuid(1),
  receivableId: uuid(101),
  transactionId: uuid(300),
  amount: usd(10000),
  receiptId: null,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
  tip: {
    transactionId: uuid(302),
    amount: usd(2000),
    categoryId: uuid(3),
    deletedAt: null,
  },
  transaction: {
    id: uuid(300),
    ledgerId: uuid(1),
    accountId: uuid(2),
    categoryId: uuid(3),
    kind: "income",
    date: "2026-10-27",
    time: null,
    amount: usd(10000),
    status: "cleared",
    payee: "Acme Studio",
    note: "Deposit paid by bank transfer, with a reference that is long enough to wrap",
    fxRate: "1.0000000000",
    baseAmount: usd(10000),
    transferId: null,
    relatedTransferId: null,
    feeTransferId: null,
    tipPaymentId: null,
    receivablePaymentId: uuid(301),
    receivableId: uuid(101),
    isSplit: false,
    splits: [],
    tags: [],
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
  },
  receivable: services[ACME]?.[1],
};

/** Clients answered from memory. */
async function withClients(page: Page) {
  await page.route(/\/contacts\?/, (route) =>
    route.fulfill({ json: { items: clients, nextCursor: null } }),
  );
  await page.route(/\/contacts\/[^/?]+\?/, (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    return route.fulfill({ json: clients.find((c) => c.id === id) });
  });
  await page.route(/\/contacts\/[^/]+\/history/, (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route(/\/receivables\?/, (route) => {
    const id = new URL(route.request().url()).searchParams.get("contactId");
    return route.fulfill({
      json: { items: services[id ?? ""] ?? [], nextCursor: null },
    });
  });
  await page.route(/\/receivables\/[^/]+\/payments/, (route) =>
    route.fulfill({
      json: {
        items: route.request().url().includes(uuid(101)) ? [payment] : [],
        nextCursor: null,
      },
    }),
  );
}

async function open(
  page: Page,
  width: number,
  path = "/clients",
  theme?: "light" | "dark",
) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  await withClients(page);
  await page.goto(path);
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  if (theme) await setTheme(page, theme);
  await expect(page.locator("#clients-title")).toBeAttached();
  // The list is hidden on a phone that opens a client, so wait for whichever pane the address shows.
  await expect(
    page
      .getByRole("region", { name: "Clients owe" })
      .or(page.locator(".cl-card"))
      .first(),
  ).toBeVisible();
}
const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not on screen");
  return found;
};
/** A box that has stopped moving: a sheet slides in, so two reads in a row must agree. */
async function settled(locator: Locator) {
  let last = await box(locator);
  for (let tries = 0; tries < 40; tries++) {
    await locator.page().waitForTimeout(60);
    const next = await box(locator);
    if (
      Math.abs(next.x - last.x) < 0.5 &&
      Math.abs(next.y - last.y) < 0.5 &&
      Math.abs(next.width - last.width) < 0.5 &&
      Math.abs(next.height - last.height) < 0.5
    )
      return next;
    last = next;
  }
  throw new Error("never settled");
}
const noSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
/** An element is a real 44 px target when a click 21 px out from its centre still lands on it. */
async function is44(page: Page, locator: Locator) {
  await locator.evaluate((node) => node.scrollIntoView({ block: "center" }));
  const found = await box(locator);
  const x = found.x + found.width / 2;
  const y = found.y + found.height / 2;
  return page.evaluate(
    ({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      const control = target?.closest("button, a, label, summary");
      return [
        [x - 21, y],
        [x + 21, y],
        [x, y - 21],
        [x, y + 21],
      ].every(([px, py]) => {
        const element = document.elementFromPoint(px as number, py as number);
        return !!element && !!control && control.contains(element);
      });
    },
    { x, y },
  );
}
const cut = (node: Locator) =>
  node.evaluate((n) => n.scrollWidth <= n.clientWidth + 1);
const links = (page: Page) => page.locator('a[id^="client-"]');
const visible = (locator: Locator) => locator.isVisible();

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280])
    test(`fits ${width} px in ${theme}: the list and a client, nothing cut, each a real target`, async ({
      page,
    }) => {
      await open(page, width, "/clients", theme);
      expect(await noSideways(page)).toBe(true);
      // Open is the chip in use, so the three who owe are the rows; the long name wraps and is never cut.
      await expect(links(page)).toHaveCount(3);
      for (const row of await links(page).all()) {
        expect((await box(row)).height).toBeGreaterThanOrEqual(56);
        for (const part of [".ui-row-title", ".ui-row-hint"])
          expect(await cut(row.locator(part))).toBe(true);
        expect(await is44(page, row)).toBe(true);
      }
      expect(
        (await box(page.getByRole("searchbox", { name: "Search clients" })))
          .height,
      ).toBeGreaterThanOrEqual(43.9);
      for (const chip of await page.locator(".cl-chips button").all())
        expect(await is44(page, chip)).toBe(true);
      expect(
        await page
          .locator(".cl-total")
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      await page.goto(`/clients/${ACME}`);
      const card = page.getByRole("region", { name: "Acme Studio" });
      await expect(card).toBeVisible();
      await expect(page.getByText("Landing page copy")).toBeVisible();
      expect(await noSideways(page)).toBe(true);
      expect(
        await card.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      for (const name of ["Record payment", /^More actions for/])
        expect(await is44(page, card.getByRole("button", { name }))).toBe(true);
      if (width >= 700)
        expect(
          await is44(page, card.getByRole("button", { name: "Log service" })),
        ).toBe(true);
      for (const row of await page.locator("button.ui-row").all()) {
        expect((await box(row)).height).toBeGreaterThanOrEqual(56);
        for (const part of [".ui-row-title", ".ui-row-hint"])
          expect(await cut(row.locator(part))).toBe(true);
        expect(await is44(page, row)).toBe(true);
      }
      for (const option of await page.getByRole("radio").all())
        expect(await is44(page, option)).toBe(true);
    });

test("a phone shows the list or one client, never both, and a tablet the same", async ({
  page,
}) => {
  for (const width of [390, 800, 1099]) {
    await open(page, width);
    expect(await visible(page.locator(".cl-list"))).toBe(true);
    expect(await visible(page.locator(".cl-detail"))).toBe(false);
    await page.goto(`/clients/${ACME}`);
    await expect(
      page.getByRole("region", { name: "Acme Studio" }),
    ).toBeVisible();
    expect(await visible(page.locator(".cl-list"))).toBe(false);
    expect(await noSideways(page)).toBe(true);
  }
});

test("from 1100 px the list and the first client are side by side, tops level, the list 320 to 400 wide", async ({
  page,
}) => {
  await open(page, 1280);
  // No client in the address: the one who owes most is open, as the prototype shows.
  await expect(page.getByRole("region", { name: "Acme Studio" })).toBeVisible();
  const list = await box(page.locator(".cl-list"));
  const detail = await box(page.locator(".cl-detail"));
  expect(detail.x).toBeGreaterThan(list.x + list.width - 1);
  expect(Math.abs(list.y - detail.y)).toBeLessThan(1);
  expect(list.width).toBeGreaterThanOrEqual(319);
  expect(list.width).toBeLessThanOrEqual(401);
  await expect(links(page).first()).toHaveAttribute("data-selected", "true");
  // Choosing another client puts it in the address and in the pane.
  await links(page).filter({ hasText: "Fjord" }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${FJORD}$`));
  await expect(page.getByRole("region", { name: "Fjord & Co" })).toBeVisible();
  await expect(links(page).filter({ hasText: "Fjord" })).toHaveAttribute(
    "data-selected",
    "true",
  );
  expect(await visible(page.locator(".cl-list"))).toBe(true);
});

test("a client has its own address that survives a reload", async ({
  page,
}) => {
  await open(page, 390, `/clients/${FJORD}`);
  await expect(page.getByRole("region", { name: "Fjord & Co" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Fjord & Co" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/clients/${FJORD}$`));
});

test("a phone's back arrow goes from a client to the list, and from the list to More", async ({
  page,
}) => {
  await open(page, 390, `/clients/${ACME}`);
  await expect(page.getByRole("region", { name: "Acme Studio" })).toBeVisible();
  await page.getByRole("link", { name: "Back to Clients" }).click();
  await expect(page).toHaveURL(/\/clients$/);
  await expect(page.getByRole("region", { name: "Clients owe" })).toBeVisible();
  await page.getByRole("link", { name: "Back to More" }).click();
  await expect(page).toHaveURL(/\/more$/);
});

test("the Add button follows the screen: clients on the list, a service on a client, and the head's own from 700 px", async ({
  page,
}) => {
  await open(page, 390);
  const fab = page.locator("#mobile-add-page");
  await expect(fab).toHaveAccessibleName("Add client");
  expect(await is44(page, fab)).toBe(true);
  await expect(page.locator("#add-client")).toBeHidden();
  await page.goto(`/clients/${ACME}`);
  await expect(fab).toHaveAccessibleName("Log service");
  await page.goto("/clients");
  await expect(fab).toHaveAccessibleName("Add client");
  // From 700 px the head carries Add client and the phone's button is gone.
  await open(page, 800);
  await expect(page.locator("#add-client")).toBeVisible();
  await expect(fab).toBeHidden();
  expect(await is44(page, page.locator("#add-client"))).toBe(true);
  await page.goto(`/clients/${ACME}`);
  await expect(page.getByRole("link", { name: "All clients" })).toBeVisible();
  await open(page, 1280);
  await expect(page.getByRole("link", { name: "All clients" })).toBeHidden();
});

test("the chips, the search and the empty answers", async ({ page }) => {
  await open(page, 390);
  await expect(links(page)).toHaveCount(3);
  await page.getByRole("button", { name: /^Settled/ }).click();
  await expect(links(page)).toHaveCount(2);
  await expect(links(page).filter({ hasText: "Lumen Labs" })).toContainText(
    "Settled",
  );
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(links(page)).toHaveCount(1);
  await expect(links(page)).toContainText("Archived");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(links(page)).toHaveCount(5);
  await page.getByRole("searchbox", { name: "Search clients" }).fill("fjord");
  await expect(links(page)).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search clients" }).fill("zzz");
  await expect(page.getByText("No clients here.")).toBeVisible();
  expect(await noSideways(page)).toBe(true);
});

test("a row in euros shows the euros and its dollar worth, and the card says at today's rates", async ({
  page,
}) => {
  await open(page, 390);
  const row = links(page).filter({ hasText: "Euro client" });
  await expect(row).toContainText("€800.00");
  await expect(row).toContainText("About $640.00");
  await row.click();
  await expect(page.getByText("About $640.00 at today's rates")).toBeVisible();
  expect(await noSideways(page)).toBe(true);
});

test("the card names what was paid this month and what is overdue, and keeps its place without one", async ({
  page,
}) => {
  await open(page, 390, `/clients/${ACME}`);
  const card = page.getByRole("region", { name: "Acme Studio" });
  await expect(card).toContainText("1 service overdue");
  await expect(card).toContainText("$500.00");
  await expect(card).toContainText(/^Acme Studio.*Paid in [A-Z][a-z]{2}/);
  const withOverdue = await box(card.locator(".cl-overdue"));
  await page.goto(`/clients/${FJORD}`);
  const fjord = page.getByRole("region", { name: "Fjord & Co" });
  await expect(fjord).toBeVisible();
  const without = await box(fjord.locator(".cl-overdue"));
  expect(without.height).toBeGreaterThanOrEqual(withOverdue.height - 0.5);
});

test("on a phone a service opens a sheet at the bottom, its payments wrap and every action is a real target", async ({
  page,
}) => {
  await open(page, 390, `/clients/${ACME}`);
  await page.getByText("Landing page copy").click();
  const sheet = page.getByRole("dialog", { name: "Landing page copy" });
  await expect(sheet).toContainText("Deposit paid by bank transfer");
  const found = await settled(sheet);
  expect(Math.abs(found.x)).toBeLessThan(1);
  expect(Math.abs(found.width - 390)).toBeLessThan(1);
  expect(Math.abs(found.y + found.height - 900)).toBeLessThan(1);
  expect(await noSideways(page)).toBe(true);
  const pay = sheet.locator(".cl-pay");
  for (const part of [".ui-row-title", ".ui-row-hint"])
    for (const node of await pay.locator(part).all())
      expect(await cut(node)).toBe(true);
  for (const name of ["Edit payment", "Delete payment"])
    expect(await is44(page, sheet.getByRole("button", { name }))).toBe(true);
  // The text has the full line; its two buttons sit under it.
  const text = await box(pay.locator(".ui-row-main"));
  const buttons = await box(pay.locator(".cl-pay-actions"));
  expect(buttons.y).toBeGreaterThanOrEqual(text.y + text.height - 1);
  for (const row of await sheet.locator("button.ui-row").all())
    expect(await is44(page, row)).toBe(true);
});

test("from 700 px a service sheet is a drawer on the right and the menu is one too", async ({
  page,
}) => {
  await open(page, 1280, `/clients/${ACME}`);
  await page.getByText("Landing page copy").click();
  const sheet = page.getByRole("dialog", { name: "Landing page copy" });
  const found = await settled(sheet);
  expect(Math.abs(found.x + found.width - 1280)).toBeLessThan(1);
  expect(found.width).toBeLessThan(600);
  expect(found.height).toBeGreaterThan(800);
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toHaveCount(0);
  await page
    .getByRole("region", { name: "Acme Studio" })
    .getByRole("button", { name: /^More actions for/ })
    .click();
  const menu = page.getByRole("dialog", { name: "Acme Studio" });
  const menuBox = await settled(menu);
  expect(Math.abs(menuBox.x + menuBox.width - 1280)).toBeLessThan(1);
});

test("Paid holds the finished services and History is a tab of the same switch", async ({
  page,
}) => {
  await open(page, 390, `/clients/${ACME}`);
  await expect(
    page.getByRole("region", { name: "Unpaid services" }),
  ).toContainText("Brand refresh, phase 2");
  await expect(page.getByRole("radio", { name: "Paid 2" })).toBeChecked();
  await expect(page.getByText("Logo")).toBeVisible();
  await expect(page.getByText("Old audit")).toBeVisible();
  await page.getByRole("radio", { name: /^History/ }).click();
  await expect(
    page.getByRole("region", { name: "Client history" }),
  ).toBeVisible();
  await expect(page.getByText("Logo")).toHaveCount(0);
});

test("privacy mode takes every amount off the list, the card and the sheet", async ({
  page,
}) => {
  await open(page, 1280, `/clients/${ACME}`);
  await page.getByRole("button", { name: "Hide amounts" }).click();
  await expect(page.locator("main")).not.toContainText("$");
  await expect(page.locator("main")).not.toContainText("€");
  await page.getByText("Landing page copy").click();
  const sheet = page.getByRole("dialog", { name: "Landing page copy" });
  await expect(sheet).toBeVisible();
  await expect(sheet).not.toContainText("$");
});

for (const theme of ["light", "dark"] as const)
  for (const width of [390, 1280])
    test(`has no accessibility violations in ${theme} at ${width} px, with the list, a client, a sheet and the menu`, async ({
      page,
    }) => {
      await open(page, width, "/clients", theme);
      const check = async () =>
        (await new AxeBuilder({ page }).analyze()).violations.map(
          (item) =>
            `${item.id}: ${item.nodes.map((node) => node.target.join(" ")).join(" | ")}`,
        );
      expect(await check()).toEqual([]);
      await page.goto(`/clients/${ACME}`);
      await expect(page.getByText("Landing page copy")).toBeVisible();
      expect(await check()).toEqual([]);
      await page.getByText("Landing page copy").click();
      const sheet = page.getByRole("dialog", { name: "Landing page copy" });
      await settled(sheet);
      expect(await check()).toEqual([]);
      await sheet.getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("button", { name: /^More actions for/ }).click();
      await settled(page.getByRole("dialog", { name: "Acme Studio" }));
      expect(await check()).toEqual([]);
    });
