import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import { clickAction } from "./client-actions";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { openMorePage } from "./more-nav";
import { signIn } from "./sign-in";

const { env, pool } = connectLocalDatabase("Clients browser tests");
let ledgerId = "",
  accountId = "",
  incomeId = "";
const root = () => `/api/v1/ledgers/${ledgerId}`;
const headers = () => ({
  origin: "http://localhost:5173",
  "idempotency-key": newId(),
});
test.beforeEach(async ({ page }, info) => {
  ledgerId = newId();
  accountId = newId();
  incomeId = newId();
  await createOwnerLedger(
    pool,
    env,
    ledgerId,
    `E2E owed ledger ${info.project.name}`,
  );
  await pool.query(
    "insert into accounts(id,ledger_id,name,type,opening_balance) values($1,$2,'Checking','bank',1000)",
    [accountId, ledgerId],
  );
  await pool.query(
    "insert into categories(id,ledger_id,name,kind) values($1,$2,'Services','income')",
    [incomeId, ledgerId],
  );
  await prepareBrowser(page, info, {
    ledgerId,
    name: "Synthetic owed ledger",
    forwarded: [150, 70],
  });
});
test.afterEach(async () => {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(
      "update receivable_payments set deleted_at=now(),version=version+1 where ledger_id=$1 and deleted_at is null",
      [ledgerId],
    );
    await c.query(
      "update transactions t set deleted_at=p.deleted_at,version=p.version from receivable_payments p where p.ledger_id=$1 and t.ledger_id=p.ledger_id and t.id=p.transaction_id",
      [ledgerId],
    );
    await c.query(
      "update receivables set deleted_at=now(),written_off_at=null,written_off_amount=null,write_off_reason=null where ledger_id=$1",
      [ledgerId],
    );
    for (const table of [
      "contacts",
      "accounts",
      "categories",
      "ledger_members",
    ])
      await c.query(`update ${table} set deleted_at=now() where ledger_id=$1`, [
        ledgerId,
      ]);
    await c.query(
      "update ledgers set deleted_at=now() where id=$1 and name like 'E2E owed ledger %'",
      [ledgerId],
    );
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
});
test.afterAll(async () => pool.end());
async function selectFits(page: Page, label: string) {
  const geometry = await page.getByLabel(label).evaluate((select) => {
    const box = select.getBoundingClientRect(),
      wrapper = select.parentElement;
    const arrow = wrapper?.querySelector("svg")?.getBoundingClientRect();
    if (!wrapper || !arrow) throw new Error("Missing select arrow");
    return {
      widthDifference: Math.abs(
        box.width - wrapper.getBoundingClientRect().width,
      ),
      inset: box.right - arrow.right,
      leftInset: arrow.left - box.left,
    };
  });
  expect(geometry.widthDifference).toBeLessThanOrEqual(1);
  expect(geometry.inset).toBeGreaterThanOrEqual(8);
  expect(geometry.leftInset).toBeGreaterThanOrEqual(8);
}
async function clients(page: Page) {
  await page.goto("/clients");
  await expect(
    page.getByRole("heading", { name: "Clients", exact: true }),
  ).toBeVisible();
}
async function client(page: Page) {
  await selectFits(page, "Client status");
  await page.getByRole("button", { name: "Add client", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Sam");
  await page.getByLabel("Email", { exact: true }).fill("sam@example.com");
  await page.getByRole("button", { name: "Save client", exact: true }).click();
  await expect(page.getByText("Client saved.", { exact: true })).toBeVisible();
  await page.locator(".client-card").filter({ hasText: "Sam" }).click();
  await expect(
    page.getByRole("heading", { name: "Sam", exact: true }),
  ).toBeVisible();
  const actionGap = await page
    .locator(".client-detail .action-bar")
    .evaluate((actions) => {
      const previous = actions.previousElementSibling;
      if (!previous) throw new Error("Missing client information");
      return (
        actions.getBoundingClientRect().top -
        previous.getBoundingClientRect().bottom
      );
    });
  expect(actionGap).toBeGreaterThanOrEqual(16);
}
async function log(page: Page, amount = "100.00") {
  await clickAction(page, "Log service");
  await expect(
    page.getByRole("dialog").getByRole("combobox", { name: /^Client/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("dialog").getByText("Client: Sam", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Description", { exact: true }).fill("Website work");
  await page.getByLabel("Service amount (USD)", { exact: true }).fill(amount);
  await page.getByLabel("Due date", { exact: true }).fill("2026-10-20");
  await page
    .getByLabel("Service time (optional)", { exact: true })
    .fill("08:15");
  await page.getByRole("button", { name: "Save service", exact: true }).click();
  await expect(page.getByText("Service saved.", { exact: true })).toBeVisible();
  await expect(page.locator(".service-row").first()).toContainText("· 8:15 AM");
}
async function record(page: Page, amount = "40.00") {
  await page
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await expect(page.getByLabel("Receiving account")).toBeVisible();
  await selectFits(page, "Receiving account");
  await page.getByLabel("Payment amount (USD)", { exact: true }).fill(amount);
  // Amount has focus, date/time/note sit under "More details", and Save comes last.
  await expect(page.getByLabel("Payment amount (USD)")).toBeFocused();
  await expect(page.getByLabel("Local time", { exact: true })).toBeHidden();
  const footer = page.getByRole("dialog").locator(".form-actions button");
  await expect(footer).toHaveText(["Close", "Save payment"]);
  await page.locator("summary").filter({ hasText: "More details" }).click();
  await page.getByLabel("Local time", { exact: true }).fill("14:32");
  await page.getByLabel("Payment note", { exact: true }).fill("Received");
  await page.getByRole("button", { name: "Save payment", exact: true }).click();
  await expect(page.getByText("Payment saved.", { exact: true })).toBeVisible();
}
async function balance(page: Page) {
  const r = await page.request.get(`${root()}/accounts/${accountId}`);
  expect(r.status()).toBe(200);
  return (await r.json()).balance.amount;
}
async function setup(page: Page) {
  await signIn(page);
  await clients(page);
  await client(page);
  await log(page);
}
async function navigate(page: Page, name: "Transactions") {
  await page
    .getByRole("link", { name, exact: true })
    .filter({ visible: true })
    .click();
}
async function confirm(page: Page) {
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(
    page.getByText("Action completed.", { exact: true }),
  ).toBeVisible();
}
test("unpaid service and partial/full payments produce exact balances and history", async ({
  page,
}) => {
  await setup(page);
  expect(await balance(page)).toBe(1000);
  await expect(page.locator(".client-detail")).toContainText("$100.00");
  await record(page);
  expect(await balance(page)).toBe(5000);
  await expect(page.locator(".service-row")).toContainText("$60.00");
  await record(page, "60.00");
  expect(await balance(page)).toBe(11000);
  await expect(page.locator(".service-row")).toContainText("Paid");
  await page
    .getByRole("button", { name: "Show payments", exact: true })
    .click();
  await expect(page.locator(".client-payments article")).toHaveCount(2);
  await expect(
    page.getByRole("heading", { name: "Payment received", exact: true }),
  ).toHaveCount(2);
});
test("linked history edit, deletion and Undo preserve identities and correct income", async ({
  page,
}) => {
  await setup(page);
  await record(page);
  const original = (
    await pool.query(
      "select id,transaction_id from receivable_payments where ledger_id=$1 and deleted_at is null",
      [ledgerId],
    )
  ).rows[0];
  await navigate(page, "Transactions");
  await expect(
    page.getByText("Service payment", { exact: false }),
  ).toBeVisible();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const detailRoute = `**/receivables/*/payments/${original.id}`;
  const delayDetail = async (route: import("@playwright/test").Route) => {
    await pending;
    await route.continue();
  };
  await page.route(detailRoute, delayDetail);
  await page
    .getByRole("button", { name: "Open transaction: Sam", exact: true })
    .click();
  await expect(
    page.getByText("Loading latest details…", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close Client editor", exact: true })
    .click();
  release();
  await page.unroute(detailRoute, delayDetail);
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save transaction", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Close transaction dialog", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open transaction: Sam", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Edit payment", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Client: Sam", { exact: true })).toBeVisible();
  await page.getByLabel("Payment amount (USD)", { exact: true }).fill("30.00");
  await page.getByRole("button", { name: "Save payment", exact: true }).click();
  await expect(page.getByText("Payment saved.", { exact: true })).toBeVisible();
  expect(await balance(page)).toBe(4000);
  await clients(page);
  await page.locator(".client-card").click();
  await page
    .getByRole("button", { name: "Show payments", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete payment", exact: true })
    .click();
  await confirm(page);
  expect(await balance(page)).toBe(1000);
  await page
    .getByRole("button", { name: "Undo Client action", exact: true })
    .click();
  await confirm(page);
  expect(await balance(page)).toBe(4000);
  const restored = (
    await pool.query(
      "select id,transaction_id from receivable_payments where ledger_id=$1 and deleted_at is null",
      [ledgerId],
    )
  ).rows[0];
  expect(restored).toEqual(original);
});
test("write-off and reopen retain received income and immutable correction history", async ({
  page,
}) => {
  await setup(page);
  await record(page);
  await clickAction(page, "Write off remainder");
  await page
    .getByLabel("Write-off reason", { exact: true })
    .fill("Uncollectible");
  await confirm(page);
  expect(await balance(page)).toBe(5000);
  await expect(page.locator(".service-row")).toContainText("Written off");
  await expect(page.locator(".client-detail")).toContainText("$0.00");
  await clickAction(page, "Reopen service");
  await confirm(page);
  await expect(page.locator(".client-detail")).toContainText("$60.00");
  await page
    .getByRole("button", { name: "Undo Client action", exact: true })
    .click();
  await confirm(page);
  await expect(page.locator(".client-detail")).toContainText("$0.00");
  await expect(
    page.locator(".history-row").filter({ hasText: "Uncollectible" }),
  ).toHaveCount(2);
});
test("interrupted payment preserves request across close/navigation and blocks Quick-add", async ({
  page,
}) => {
  await setup(page);
  const independent = await page.request.post(`${root()}/transactions`, {
    headers: headers(),
    data: {
      accountId,
      categoryId: incomeId,
      kind: "income",
      date: "2026-10-07",
      amount: { amount: 100, currency: "USD" },
      status: "cleared",
      payee: "Independent receipt",
    },
  });
  expect(independent.status()).toBe(201);
  await navigate(page, "Transactions");
  await page
    .locator(".transaction-row")
    .filter({ hasText: "Independent receipt" })
    .click();
  await page
    .getByRole("button", { name: "Delete transaction", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Undo deletion", exact: true }),
  ).toBeEnabled();
  await openMorePage(page, "Clients");
  await page.locator(".client-card").filter({ hasText: "Sam" }).click();
  let interrupted = false;
  const seen: { key: string | null; body: string | null }[] = [];
  await page.route(
    "**/api/v1/ledgers/*/receivables/*/payments",
    async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      seen.push({
        key: route.request().headers()["idempotency-key"] ?? null,
        body: route.request().postData(),
      });
      if (!interrupted) {
        interrupted = true;
        await route.fetch();
        return route.abort("failed");
      }
      return route.continue();
    },
  );
  await page
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await page.getByLabel("Payment amount (USD)", { exact: true }).fill("40.00");
  await page.getByRole("button", { name: "Save payment", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry same action", exact: true }),
  ).toBeVisible();
  expect(await balance(page)).toBe(5000);
  await page
    .getByRole("button", { name: "Close Client editor", exact: true })
    .click();
  await navigate(page, "Transactions");
  await expect(
    page.getByRole("button", { name: "Undo deletion", exact: true }),
  ).toBeDisabled();
  const clientNotice = await page.locator(".client-toast").boundingBox();
  const historyNotice = await page
    .getByRole("group", { name: "Transaction history notification" })
    .boundingBox();
  expect(clientNotice).not.toBeNull();
  expect(historyNotice).not.toBeNull();
  if (!clientNotice || !historyNotice)
    throw new Error("Expected both action notifications");
  expect(clientNotice.y + clientNotice.height).toBeLessThanOrEqual(
    historyNotice.y - 8,
  );
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save transaction", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Close transaction dialog", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Resume Client action", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Retry same action", exact: true })
    .click();
  await expect(page.getByText("Payment saved.", { exact: true })).toBeVisible();
  expect(seen).toHaveLength(2);
  expect(seen[1]).toEqual(seen[0]);
  expect(await balance(page)).toBe(5000);
});
test("interrupted edit/delete/Undo/write-off replay original actions", async ({
  page,
}) => {
  await setup(page);
  await record(page);
  await page
    .getByRole("button", { name: "Show payments", exact: true })
    .click();
  const seen = new Map<
      string,
      { key: string | undefined; body: string | null }[]
    >(),
    broken = new Set<string>();
  await page.route("**/api/v1/ledgers/*/receivables/**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.continue();
    const operation = `${request.method()} ${new URL(request.url()).pathname}`;
    const list = seen.get(operation) ?? [];
    list.push({
      key: request.headers()["idempotency-key"],
      body: request.postData(),
    });
    seen.set(operation, list);
    if (!broken.has(operation)) {
      broken.add(operation);
      await route.fetch();
      return route.abort("failed");
    }
    return route.continue();
  });
  async function retry() {
    await expect(
      page.getByRole("button", { name: "Retry same action", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close Client editor", exact: true })
      .click();
    await navigate(page, "Transactions");
    await page
      .getByRole("button", { name: "Resume Client action", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Retry same action", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await openMorePage(page, "Clients");
    await page.locator(".client-card").click();
  }
  await page.getByRole("button", { name: "Edit payment", exact: true }).click();
  await page.getByLabel("Payment amount (USD)", { exact: true }).fill("30.00");
  await page.getByRole("button", { name: "Save payment", exact: true }).click();
  await retry();
  expect(await balance(page)).toBe(4000);
  await page
    .getByRole("button", { name: "Show payments", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete payment", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await retry();
  expect(await balance(page)).toBe(1000);
  await page
    .getByRole("button", { name: "Undo Client action", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await retry();
  expect(await balance(page)).toBe(4000);
  await clickAction(page, "Write off remainder");
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await retry();
  expect(await balance(page)).toBe(4000);
  for (const list of seen.values()) {
    expect(list).toHaveLength(2);
    expect(list[1]).toEqual(list[0]);
  }
});
for (const [name, size] of [
  ["desktop", { width: 1280, height: 800 }],
  ["phone", { width: 390, height: 800 }],
] as const) {
  test(`deleting a client returns to All clients without an error (${name})`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await signIn(page);
    await clients(page);
    await client(page);
    await clickAction(page, "Delete client");
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(
      page.getByText("Client deleted.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Could not load/)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "All clients", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".client-card")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add client", exact: true }),
    ).toBeVisible();
  });
}
test("client and service actions use one primary plus a menu on phones and inline buttons on desktop", async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 320, height: 800 });
  // Phone: every visible control is at least 44 px and nothing overflows.
  await expect(
    page.getByRole("button", { name: "More actions for Website work" }),
  ).toBeVisible();
  // On the client card Log service is the one visible primary; Record payment sits in the menu.
  const logService = page.getByRole("button", {
    name: "Log service",
    exact: true,
  });
  await expect(logService).toBeVisible();
  await expect(logService).toHaveClass(/action-primary/);
  await expect(
    page.getByRole("button", { name: /^Record payment from/ }),
  ).toHaveCount(0);
  const cardBar = page.locator(".client-detail .action-bar");
  const cardButtons = await cardBar.locator("button").all();
  expect(cardButtons).toHaveLength(2);
  const heights = await Promise.all(
    cardButtons.map(async (b) => (await b.boundingBox())?.height ?? 0),
  );
  expect(heights[0]).toBe(heights[1]);
  for (const [width, theme] of [
    [320, "light"],
    [320, "dark"],
    [390, "light"],
    [390, "dark"],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ colorScheme: theme });
    await page.locator(".client-detail").screenshot({
      path: join(tmpdir(), `ledgerline-client-card-${width}-${theme}.png`),
    });
  }
  await page.setViewportSize({ width: 320, height: 800 });
  const cardMenu = cardBar.getByRole("button", { name: /^More actions for/ });
  await cardMenu.focus();
  await page.keyboard.press("Enter");
  const payItem = page.getByRole("menuitem", {
    name: /^Record payment from/,
  });
  await expect(payItem).toBeVisible();
  expect((await payItem.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole("menuitem").first()).toHaveText(
    /^Record payment from/,
  );
  await page.keyboard.press("Escape");
  await expect(cardMenu).toBeFocused();
  const bars = page.locator(".action-bar");
  await expect(bars).toHaveCount(2);
  for (const button of await page.locator(".action-bar button").all()) {
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // The primary shares a row with the menu trigger (one natural line).
  const row = await page.locator(".service-row .action-bar").boundingBox();
  expect(row?.height ?? 0).toBeLessThan(60);
  const trigger = page.getByRole("button", {
    name: "More actions for Website work",
  });
  await trigger.click();
  const items = page.getByRole("menuitem");
  await expect(items).toHaveText([
    "Edit service",
    "Write off remainder",
    "Delete service",
  ]);
  await expect(items.last()).toHaveCSS(
    "color",
    /^rgb\(185, 28, 28\)$|^rgb\(252, 165, 165\)$/,
  );
  await page.keyboard.press("Escape");
  await expect(items).toHaveCount(0);
  await expect(trigger).toBeFocused();
  // Desktop: the same actions are inline text buttons.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(
    page.getByRole("button", { name: "Edit client", exact: true }),
  ).toContainText("Edit client");
  await expect(
    page.getByRole("button", { name: "Delete service", exact: true }),
  ).toHaveCSS("color", /^rgb\(185, 28, 28\)$|^rgb\(252, 165, 165\)$/);
});
test("stale reload, privacy/viewer and 320px light/dark details", async ({
  page,
}, info) => {
  await setup(page);
  await record(page);
  await page
    .getByRole("button", { name: "Show payments", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit payment", exact: true }).click();
  const service = (
    await pool.query(
      "select id,version from receivables where ledger_id=$1 and deleted_at is null",
      [ledgerId],
    )
  ).rows[0];
  const data = await (
    await page.request.get(`${root()}/receivables/${service.id}`)
  ).json();
  await page.request.patch(`${root()}/receivables/${service.id}`, {
    headers: headers(),
    data: {
      contactId: data.contactId,
      description: "Corrected work",
      serviceDate: data.serviceDate,
      dueDate: data.dueDate,
      amount: data.amount,
      expectedVersion: data.version,
    },
  });
  await page.getByLabel("Payment amount (USD)", { exact: true }).fill("20.00");
  await page.getByRole("button", { name: "Save payment", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Reload latest details", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reload latest details", exact: true })
    .click();
  await expect(
    page.getByLabel("Payment amount (USD)", { exact: true }),
  ).toHaveValue("40.00");
  await page
    .getByRole("button", { name: "Close Client editor", exact: true })
    .click();
  await page.getByRole("button", { name: "Hide amounts", exact: true }).click();
  await expect(page.locator(".client-detail")).not.toContainText("$");
  await expect(
    page.getByRole("region", { name: "Client history", exact: true }),
  ).not.toContainText("$");
  await page.getByRole("button", { name: "Edit payment", exact: true }).click();
  await expect(
    page.getByLabel("Payment amount (USD)", { exact: true }),
  ).toHaveAttribute("type", "password");
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    if (info.project.name === "desktop") {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({
        path: join(tmpdir(), `ledgerline-client-wide-${theme}.png`),
      });
    }
    await page.setViewportSize({ width: 320, height: 740 });
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
    await page.screenshot({
      path: join(
        tmpdir(),
        `ledgerline-client-${info.project.name}-${theme}.png`,
      ),
    });
  }
  await page
    .getByRole("button", { name: "Close Client editor", exact: true })
    .click();
  const contacts = await page.request.get(`${root()}/contacts`);
  expect(contacts.status()).toBe(200);
  const contact = (await contacts.json()).items[0];
  const renamed = await page.request.patch(`${root()}/contacts/${contact.id}`, {
    headers: headers(),
    data: {
      name: "A".repeat(100),
      phone: contact.phone,
      email: contact.email,
      note: contact.note,
      expectedVersion: contact.version,
    },
  });
  expect(renamed.status()).toBe(200);
  await clients(page);
  await expect(page.locator(".client-card")).toContainText("A".repeat(100));
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await page.screenshot({
    path: join(
      tmpdir(),
      `ledgerline-client-long-name-${info.project.name}.png`,
    ),
  });
  await pool.query(
    "update ledger_members set role='viewer' where ledger_id=$1",
    [ledgerId],
  );
  await page.route("**/api/v1/ledgers", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: ledgerId,
            name: "Synthetic owed ledger",
            timeZone: null,
            version: 1,
            baseCurrency: "USD",
            role: "viewer",
          },
        ],
      },
    }),
  );
  await page.reload();
  await page.locator(".client-card").click();
  await expect(
    page.getByRole("button", { name: "Log service", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Show payments", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Payment details", exact: true })
    .click();
  await expect(
    page.getByLabel("Payment amount (USD)", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save payment", exact: true }),
  ).toHaveCount(0);
});
test("the Undo left in the corner can be dismissed with its cross", async ({
  page,
}) => {
  await setup(page);
  await clickAction(page, "Delete service");
  await confirm(page);
  // After the notification closes, Undo waits in the corner with a cross beside it.
  const dismiss = page.getByRole("button", {
    name: "Dismiss undo",
    exact: true,
  });
  await expect(dismiss).toBeVisible({ timeout: 10_000 });
  const box = await dismiss.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await dismiss.click();
  await expect(dismiss).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Undo Client action", exact: true }),
  ).toHaveCount(0);
});
test("service deletion Undo and client archive preserve open history; removed account blocks payment Undo", async ({
  page,
}) => {
  await setup(page);
  await clickAction(page, "Delete service");
  await confirm(page);
  await expect(page.locator(".service-row")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Undo Client action", exact: true })
    .click();
  await confirm(page);
  await expect(page.locator(".service-row")).toHaveCount(1);
  await record(page);
  await clickAction(page, "Archive client");
  await confirm(page);
  await expect(page.locator(".client-detail")).toContainText("$60.00");
  await page
    .getByRole("button", { name: "Show payments", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete payment", exact: true })
    .click();
  await confirm(page);
  expect(
    (
      await page.request.delete(`${root()}/accounts/${accountId}`, {
        headers: headers(),
        data: { expectedVersion: 1 },
      })
    ).status(),
  ).toBe(204);
  await page
    .getByRole("button", { name: "Undo Client action", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("not found");
  const count = (
    await pool.query(
      "select count(*) from receivable_payments where ledger_id=$1 and deleted_at is null",
      [ledgerId],
    )
  ).rows[0].count;
  expect(count).toBe("0");
});
test("hourly work: hours at a rate fills the amount and a blank description", async ({
  page,
}) => {
  await signIn(page);
  await clients(page);
  await client(page);
  await page.getByRole("button", { name: "Log service", exact: true }).click();
  await page
    .locator("summary")
    .filter({ hasText: "Work paid by the hour" })
    .click();
  await page.getByLabel("Hours", { exact: true }).fill("3.5");
  await page.getByLabel("Hourly rate (USD)", { exact: true }).fill("40");
  await expect(
    page.getByRole("status").filter({ hasText: "3.5 h at" }),
  ).toContainText("$140.00");
  await page.setViewportSize({ width: 320, height: 900 });
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.getByRole("dialog").screenshot({
      path: join(tmpdir(), `ledgerline-hourly-320-${theme}.png`),
    });
  }
  await page
    .getByRole("button", { name: "Use this total", exact: true })
    .click();
  await expect(
    page.getByLabel("Service amount (USD)", { exact: true }),
  ).toHaveValue("140.00");
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
    "3.5 h at $40.00/h",
  );
  await page.getByRole("button", { name: "Save service", exact: true }).click();
  await expect(page.getByText("Service saved.", { exact: true })).toBeVisible();
  await expect(page.locator(".service-row").first()).toContainText("$140.00");
  await expect(page.locator(".service-row").first()).toContainText(
    "3.5 h at $40.00/h",
  );
});
async function addTipCategory() {
  const id = newId();
  await pool.query(
    "insert into categories(id,ledger_id,name,kind) values($1,$2,'Tips','income')",
    [id, ledgerId],
  );
  return id;
}
const incomeRows = async () =>
  (
    await pool.query(
      "select amount::text as amount, tip_payment_id, receivable_payment_id, deleted_at from transactions where ledger_id=$1 and kind='income' order by amount",
      [ledgerId],
    )
  ).rows as {
    amount: string;
    tip_payment_id: string | null;
    receivable_payment_id: string | null;
    deleted_at: Date | null;
  }[];
test("paying more than is owed saves the extra as a separate tip, and Undo removes both", async ({
  page,
}) => {
  await addTipCategory();
  await signIn(page);
  await clients(page);
  await client(page);
  await log(page);
  await page
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await expect(page.getByLabel("Receiving account")).toBeVisible();
  await expect(page.getByText("Category for the tip")).toHaveCount(0);
  await page.getByLabel("Payment amount (USD)", { exact: true }).fill("120.00");
  await expect(
    page.getByRole("status").filter({ hasText: "tip" }),
  ).toContainText("settles $100.00. The extra $20.00 is saved as a tip");
  await expect(page.getByText("Category for the tip")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 1100 });
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.getByRole("dialog").screenshot({
      path: join(tmpdir(), `ledgerline-tip-320-${theme}.png`),
    });
  }
  await page.getByRole("button", { name: "Save payment", exact: true }).click();
  await expect(page.getByText("Payment saved.", { exact: true })).toBeVisible();
  const saved = await incomeRows();
  expect(saved.map((r) => r.amount)).toEqual(["10000", "2000"]);
  expect(saved.find((r) => r.amount === "2000")?.tip_payment_id).toBeTruthy();
  await page
    .getByRole("button", { name: "Show payments", exact: true })
    .click();
  await expect(page.locator(".client-payments")).toContainText("Tip $20.00");
  await expect(page.locator(".client-detail")).toContainText("$0.00");
  await page
    .getByRole("button", { name: "Undo Client action", exact: true })
    .click();
  await confirm(page);
  expect((await incomeRows()).every((r) => r.deleted_at !== null)).toBe(true);
});
test("one receipt above the open balance saves a single tip", async ({
  page,
}) => {
  await addTipCategory();
  await signIn(page);
  await clients(page);
  await client(page);
  await log(page);
  await clickAction(page, "Record payment from Sam");
  await page.getByLabel("Payment amount (USD)", { exact: true }).fill("130.00");
  await expect(
    page.getByRole("status").filter({ hasText: "tip" }),
  ).toContainText("The extra $30.00 is saved as a tip");
  await expect(page.getByText("Pays 1 service in full.")).toBeVisible();
  await page.getByRole("button", { name: "Save payment", exact: true }).click();
  await expect(
    page.getByText("Payment applied to the client's services.", {
      exact: true,
    }),
  ).toBeVisible();
  const saved = await incomeRows();
  expect(saved.map((r) => r.amount)).toEqual(["10000", "3000"]);
  expect(saved.filter((r) => r.tip_payment_id)).toHaveLength(1);
});
