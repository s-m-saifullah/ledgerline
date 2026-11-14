import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import { clickAction, openService } from "./client-actions";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";
import { setTheme } from "./theme";

// The Clients editors in a real browser (ADR 0047, PR 10b), against the approved prototype: jsdom cannot run
// container queries or measure a sheet, so the sheet against the drawer, the pinned foot, the question, the
// fields, the targets and the privacy mode are measured here. The ledger is synthetic (a real API, a new
// ledger), so nothing of the owner's is touched.
const { env, pool } = connectLocalDatabase("Clients editors browser tests");
let ledgerId = "";
let samId = "";
let accountId = "";
const root = () => `/api/v1/ledgers/${ledgerId}`;
const headers = () => ({
  origin: "http://localhost:5173",
  "idempotency-key": newId(),
});
const LONG = "Landing page copy with a description long enough to wrap twice";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  ledgerId = newId();
  accountId = newId();
  samId = newId();
  await createOwnerLedger(
    pool,
    env,
    ledgerId,
    "E2E clients editors ledger layout",
  );
  await pool.query(
    "insert into accounts(id,ledger_id,name,type,opening_balance) values($1,$2,'Checking','bank',1000)",
    [accountId, ledgerId],
  );
  await pool.query(
    "insert into categories(id,ledger_id,name,kind) values($1,$2,'Services','income')",
    [newId(), ledgerId],
  );
  await pool.query(
    "insert into contacts(id,ledger_id,name) values($1,$2,'Sam'),($3,$2,'Ana')",
    [samId, ledgerId, newId()],
  );
  const services = [
    ["Logo", "2026-09-01", 20000],
    [LONG, "2026-09-05", 30000],
    ["Website work", "2026-09-20", 100000],
  ] as const;
  for (const [description, date, amount] of services)
    await pool.query(
      "insert into receivables(id,ledger_id,contact_id,description,service_date,amount,currency) values($1,$2,$3,$4,$5,$6,'USD')",
      [newId(), ledgerId, samId, description, date, amount],
    );
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic clients editors ledger",
    forwarded: [180, 40],
  });
});
test.afterEach(async () => {
  // A skipped project made no ledger.
  if (!ledgerId) return;
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
      "update ledgers set deleted_at=now() where id=$1 and name like 'E2E clients editors ledger%'",
      [ledgerId],
    );
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
    ledgerId = "";
  }
});
test.afterAll(async () => pool.end());

/** One payment on the long service and one receipt over the logo and the rest of the long service. */
async function seedPayments(page: Page) {
  const services = (
    await (await page.request.get(`${root()}/receivables?limit=50`)).json()
  ).items as { id: string; description: string; version: number }[];
  const long = services.find((s) => s.description === LONG);
  if (!long) throw new Error("Missing the long service");
  const categories = (
    await (await page.request.get(`${root()}/categories?limit=50`)).json()
  ).items as { id: string; name: string }[];
  const categoryId = categories.find((c) => c.name === "Services")?.id;
  const paid = await page.request.post(
    `${root()}/receivables/${long.id}/payments`,
    {
      headers: headers(),
      data: {
        amount: { amount: 10000, currency: "USD" },
        accountId,
        categoryId,
        date: "2026-10-08",
        note: "Deposit paid by bank transfer, with a reference that is long enough to wrap",
        expectedReceivableVersion: long.version,
      },
    },
  );
  expect(paid.status()).toBe(201);
  const preview = await (
    await page.request.get(
      `${root()}/contacts/${samId}/receipt-preview?amount=30000&currency=USD`,
    )
  ).json();
  const receipt = await page.request.post(
    `${root()}/contacts/${samId}/receipts`,
    {
      headers: headers(),
      data: {
        amount: { amount: 30000, currency: "USD" },
        accountId,
        categoryId,
        date: "2026-10-21",
        expectedAllocations: preview.allocations.map(
          (a: {
            receivableId: string;
            version: number;
            applied: { amount: number };
          }) => ({
            receivableId: a.receivableId,
            expectedVersion: a.version,
            applied: a.applied.amount,
          }),
        ),
      },
    },
  );
  expect(receipt.status()).toBe(201);
}

async function open(
  page: Page,
  width: number,
  path: string,
  theme?: "light" | "dark",
) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 800 });
  await signIn(page);
  await page.goto(path);
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  if (theme) await setTheme(page, theme);
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
      const control = target?.closest("button, a, label, summary, select");
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

const clientPath = () => `/clients/${samId}`;
const editors = [
  {
    name: "Add client",
    path: () => "/clients",
    open: async (page: Page) =>
      page
        .getByRole("button", { name: "Add client", exact: true })
        .filter({ visible: true })
        .first()
        .click(),
    title: "Add client",
  },
  {
    name: "Log service",
    path: clientPath,
    open: (page: Page) => clickAction(page, "Log service"),
    title: "Log service",
  },
  {
    name: "Edit service",
    path: clientPath,
    open: async (page: Page) => {
      const sheet = await openService(page, "Website work");
      await sheet.getByRole("button", { name: "Edit service" }).click();
    },
    title: "Edit service",
  },
  {
    name: "Record payment on a service",
    path: clientPath,
    open: async (page: Page) => {
      const sheet = await openService(page, "Website work");
      await sheet.getByRole("button", { name: "Record payment" }).click();
    },
    title: "Record payment",
  },
  {
    name: "Edit payment",
    path: clientPath,
    open: async (page: Page) => {
      const sheet = await openService(page, LONG);
      await sheet.getByRole("button", { name: "Edit payment" }).click();
    },
    title: "Edit payment",
  },
  {
    name: "Edit receipt",
    path: clientPath,
    open: async (page: Page) => {
      const sheet = await openService(page, "Logo");
      await sheet.getByRole("button", { name: "Edit receipt" }).click();
    },
    title: "Edit receipt",
  },
  {
    name: "Record payment from a client",
    path: clientPath,
    open: (page: Page) => clickAction(page, "Record payment from Sam"),
    title: "Record payment from Sam",
  },
] as const;

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280])
    test(`every editor fits ${width} px in ${theme}: a sheet or a drawer, the foot pinned, nothing cut, each a real target`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await open(page, width, clientPath(), theme);
      await seedPayments(page);
      for (const editor of editors) {
        await page.goto(editor.path());
        await expect(page.locator("#clients-title")).toBeAttached();
        await editor.open(page);
        const dialog = page.getByRole("dialog", {
          name: editor.title,
          exact: true,
        });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText("Loading latest details…")).toHaveCount(
          0,
        );
        const sheet = await settled(dialog);
        const label = `${editor.name} at ${width}`;
        if (width < 700) {
          expect(sheet.width, label).toBeGreaterThanOrEqual(width - 1);
          expect(sheet.y + sheet.height, label).toBeGreaterThanOrEqual(799);
        } else {
          expect(sheet.x + sheet.width, label).toBeGreaterThanOrEqual(
            width - 1,
          );
          expect(sheet.width, label).toBeGreaterThanOrEqual(439);
          expect(sheet.width, label).toBeLessThanOrEqual(561);
        }
        expect(await noSideways(page), label).toBe(true);
        // The foot stays on screen with the sheet, and the head holds Cancel.
        const foot = dialog.locator(".ui-sheet-foot");
        await expect(foot, label).toBeVisible();
        const footBox = await box(foot);
        expect(footBox.y + footBox.height, label).toBeLessThanOrEqual(801);
        await expect(
          dialog.locator(".ui-sheet-head").getByRole("button", {
            name: "Cancel",
            exact: true,
          }),
        ).toBeVisible();
        // Titles, hints and labels wrap; none is cut.
        for (const part of [
          ".ui-row-title",
          ".ui-row-hint",
          ".ed-field > label",
        ])
          for (const node of await dialog.locator(part).all())
            if (await node.isVisible())
              expect(await cut(node), `${label} ${part}`).toBe(true);
        // Real targets: the foot's buttons, the fold and the pick rows.
        for (const control of [
          ...(await foot.getByRole("button").all()),
          ...(await dialog.locator("summary").all()),
          ...(await dialog.locator(".ui-pick-row").all()),
        ])
          if (await control.isVisible())
            expect(await is44(page, control), label).toBe(true);
        const results = await new AxeBuilder({ page })
          .include('[role="dialog"]')
          .analyze();
        expect(results.violations, label).toEqual([]);
        await closeDialog(page, dialog);
      }
    });

async function closeDialog(page: Page, dialog: Locator) {
  await dialog
    .locator(".ui-sheet-head")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("the service form marks the time and the due date Optional, and the payment form folds date, time and note", async ({
  page,
}) => {
  await open(page, 1280, clientPath());
  await seedPayments(page);
  await page.goto(clientPath());
  await clickAction(page, "Log service");
  const dialog = page.getByRole("dialog", { name: "Log service" });
  await expect(
    dialog.getByRole("textbox", { name: "Time (Optional)", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "Due date (Optional)", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "Service date", exact: true }),
  ).toBeVisible();
  // Each is a row (the prototype's input row): the label on the left, the value on the right, one under the other.
  const date = await box(dialog.locator("#client-serviceDate"));
  const time = await box(dialog.locator("#client-serviceTime"));
  const due = await box(dialog.locator("#client-dueDate"));
  expect(time.y).toBeGreaterThan(date.y + date.height - 1);
  expect(due.y).toBeGreaterThan(time.y + time.height - 1);
  const label = await box(dialog.locator('label[for="client-serviceDate"]'));
  expect(label.x + label.width).toBeLessThanOrEqual(date.x + 1);
  const card = await box(dialog.locator(".ed-card").first());
  expect(card.x + card.width - (date.x + date.width)).toBeLessThan(24);
  await closeDialog(page, dialog);
  const sheet = await openService(page, "Website work");
  await sheet.getByRole("button", { name: "Record payment" }).click();
  const pay = page.getByRole("dialog", { name: "Record payment" });
  // Recording has no trash: there is nothing yet to delete (asked once the sheet has its fields).
  await expect(pay.getByLabel("Payment amount (USD)")).toBeVisible();
  await expect(pay.getByRole("button", { name: "Save payment" })).toBeVisible();
  await expect(pay.getByRole("button", { name: "Delete payment" })).toHaveCount(
    0,
  );
  const fold = pay.locator("details.ed-fold");
  await expect(fold).toHaveJSProperty("open", false);
  await expect(
    pay.getByRole("textbox", { name: "Payment date", exact: true }),
  ).toBeHidden();
  await fold.locator("summary").click();
  await expect(
    pay.getByRole("textbox", { name: "Payment date", exact: true }),
  ).toBeVisible();
  await expect(
    pay.getByRole("textbox", { name: "Time (Optional)", exact: true }),
  ).toBeVisible();
  await expect(
    pay.getByRole("textbox", { name: "Payment note", exact: true }),
  ).toBeVisible();
});

test("the hours result and Use this total keep their own full border", async ({
  page,
}) => {
  await open(page, 390, clientPath());
  await clickAction(page, "Log service");
  const dialog = page.getByRole("dialog", { name: "Log service" });
  await dialog
    .locator("summary")
    .filter({ hasText: "Paid by the hour" })
    .click();
  await dialog.getByLabel("Hours", { exact: true }).fill("12");
  await dialog.getByLabel("Hourly rate (USD)", { exact: true }).fill("0.12");
  const button = dialog.getByRole("button", { name: "Use this total" });
  await expect(button).toBeVisible();
  const borders = await button.evaluate((node) => {
    const cs = getComputedStyle(node);
    return [
      cs.borderTopWidth,
      cs.borderRightWidth,
      cs.borderBottomWidth,
      cs.borderLeftWidth,
    ].concat([cs.borderTopColor === cs.borderBottomColor ? "same" : "differs"]);
  });
  expect(borders).toEqual(["1px", "1px", "1px", "1px", "same"]);
});

test("the date and time stay rows on a phone, and the big amount is the entry sheet's field", async ({
  page,
}) => {
  await open(page, 320, clientPath());
  await clickAction(page, "Log service");
  const dialog = page.getByRole("dialog", { name: "Log service" });
  const date = await box(
    dialog.getByRole("textbox", { name: "Service date", exact: true }),
  );
  const time = await box(
    dialog.getByRole("textbox", { name: "Time (Optional)", exact: true }),
  );
  expect(time.y).toBeGreaterThan(date.y + date.height - 1);
  await closeDialog(page, dialog);
  const sheet = await openService(page, "Website work");
  await sheet.getByRole("button", { name: "Record payment" }).click();
  const pay = page.getByRole("dialog", { name: "Record payment" });
  const amount = pay.getByLabel("Payment amount (USD)");
  await expect(amount).toHaveValue("1000.00");
  await expect(amount).toBeFocused();
  await expect(pay.locator(".entry-amount-code")).toHaveText("USD");
  const fontSize = await amount.evaluate((node) =>
    Number.parseFloat(getComputedStyle(node).fontSize),
  );
  expect(fontSize).toBeGreaterThanOrEqual(31);
});

test("a question is a centred dialog with Cancel beside one button, and the word is the action", async ({
  page,
}) => {
  for (const width of [390, 1280]) {
    await open(page, width, clientPath());
    await clickAction(page, "Delete service");
    const question = page.getByRole("dialog", { name: "Delete service" });
    await expect(question).toBeVisible();
    const found = await settled(question);
    expect(Math.abs(found.x + found.width / 2 - width / 2)).toBeLessThan(2);
    expect(found.y).toBeGreaterThan(40);
    expect(found.y + found.height).toBeLessThan(800);
    await expect(question).toContainText(
      "Delete a service only after its payments are deleted.",
    );
    const actions = question.locator(".ui-question-actions button");
    await expect(actions).toHaveText(["Cancel", "Delete"]);
    await expect(actions.nth(1)).toHaveClass(/ui-btn-danger-filled/);
    for (const button of await actions.all())
      expect(await is44(page, button)).toBe(true);
    await question.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await clickAction(page, "Archive client");
    const archive = page.getByRole("dialog", { name: "Archive client" });
    await expect(archive.locator(".ui-question-actions button")).toHaveText([
      "Cancel",
      "Archive",
    ]);
    await expect(archive.locator(".ui-btn-danger-filled")).toHaveCount(0);
    await archive.getByRole("button", { name: "Cancel" }).click();
  }
});

test("the trash beside Save asks first, Keep leaves the sheet, and Delete removes the payment", async ({
  page,
}) => {
  await open(page, 390, clientPath());
  await seedPayments(page);
  await page.goto(clientPath());
  const sheet = await openService(page, LONG);
  await sheet.getByRole("button", { name: "Edit payment" }).click();
  const edit = page.getByRole("dialog", { name: "Edit payment" });
  await expect(edit).toBeVisible();
  const trash = edit.getByRole("button", { name: "Delete payment" });
  expect(await is44(page, trash)).toBe(true);
  await trash.click();
  const question = page.getByRole("dialog", { name: "Delete payment" });
  await expect(question).toBeVisible();
  await expect(question).toContainText(
    "Deletes the payment, its income entry and any tip together.",
  );
  await question.getByRole("button", { name: "Cancel" }).click();
  await expect(edit).toBeVisible();
  const live = () =>
    pool
      .query(
        "select count(*)::int as n from receivable_payments where ledger_id=$1 and deleted_at is null and receipt_id is null",
        [ledgerId],
      )
      .then((r) => r.rows[0].n as number);
  expect(await live()).toBe(1);
  await trash.click();
  await page
    .getByRole("dialog", { name: "Delete payment" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(
    page.getByText("Action completed.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await live()).toBe(0);
  // Undo is offered in the corner.
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeVisible();
});

test("the trash waits while a save is on its way", async ({ page }) => {
  await open(page, 1280, clientPath());
  await seedPayments(page);
  await page.goto(clientPath());
  const sheet = await openService(page, LONG);
  await sheet.getByRole("button", { name: "Edit payment" }).click();
  const edit = page.getByRole("dialog", { name: "Edit payment" });
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    /\/receivables\/[^/?]+\/payments\/[^/?]+$/,
    async (route) => {
      if (route.request().method() === "PATCH") await held;
      await route.continue();
    },
  );
  await edit.getByRole("button", { name: "Save payment" }).click();
  await expect(
    edit.getByRole("button", { name: "Delete payment" }),
  ).toBeDisabled();
  release();
  await expect(page.getByText("Payment saved.", { exact: true })).toBeVisible();
});

test("the trash on a receipt asks too, and Delete removes every payment it made", async ({
  page,
}) => {
  await open(page, 1280, clientPath());
  await seedPayments(page);
  await page.goto(clientPath());
  const sheet = await openService(page, "Logo");
  await sheet.getByRole("button", { name: "Edit receipt" }).click();
  const edit = page.getByRole("dialog", { name: "Edit receipt" });
  await edit.getByRole("button", { name: "Delete receipt" }).click();
  const question = page.getByRole("dialog", { name: "Delete receipt" });
  await expect(question).toContainText(
    "Deletes every payment it made, their income entries and any tip together.",
  );
  await question.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByText("Action completed.", { exact: true }),
  ).toBeVisible();
  const live = await pool.query(
    "select count(*)::int as n from receivable_payments where ledger_id=$1 and deleted_at is null and receipt_id is not null",
    [ledgerId],
  );
  expect(live.rows[0].n).toBe(0);
});

test("a receipt's Save waits for the preview, and the preview lists what it pays, oldest first", async ({
  page,
}) => {
  await open(page, 1280, clientPath());
  await clickAction(page, "Record payment from Sam");
  const dialog = page.getByRole("dialog", { name: "Record payment from Sam" });
  const save = dialog.getByRole("button", { name: "Save payment" });
  await expect(save).toBeDisabled();
  await dialog.getByLabel("Payment amount (USD)").fill("250");
  const rows = dialog.locator(".receipt-preview .ui-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Logo");
  await expect(rows.nth(0)).toContainText("Paid in full");
  await expect(rows.nth(1)).toContainText("left");
  await expect(dialog.getByText("Pays, oldest first")).toBeVisible();
  await dialog
    .getByLabel("Receiving account")
    .selectOption({ label: "Checking" });
  await expect(save).toBeEnabled();
  await dialog.getByRole("button", { name: "Pay full balance" }).click();
  await expect(dialog.getByLabel("Payment amount (USD)")).toHaveValue(
    "1500.00",
  );
});

test("privacy mode keeps the amounts of every editor out of sight", async ({
  page,
}) => {
  await open(page, 1280, clientPath());
  await seedPayments(page);
  await page.goto(clientPath());
  await page.getByRole("button", { name: "Hide amounts", exact: true }).click();
  const sheet = await openService(page, "Website work");
  await sheet.getByRole("button", { name: "Record payment" }).click();
  const pay = page.getByRole("dialog", { name: "Record payment" });
  await expect(pay.getByLabel("Payment amount (USD)")).toHaveAttribute(
    "type",
    "password",
  );
  await expect(pay).not.toContainText("$1,000.00");
  await closeDialog(page, pay);
  await clickAction(page, "Record payment from Sam");
  const receive = page.getByRole("dialog", { name: "Record payment from Sam" });
  await receive.getByLabel("Payment amount (USD)").fill("250");
  await expect(
    receive.locator(".receipt-preview .ui-row").first(),
  ).toBeVisible();
  await expect(receive).not.toContainText("$");
  await closeDialog(page, receive);
  await clickAction(page, "Log service");
  const log = page.getByRole("dialog", { name: "Log service" });
  await expect(log.getByLabel("Service amount (USD)")).toHaveAttribute(
    "type",
    "password",
  );
});

test("a quick load never shows a placeholder, and a slow one shows a plain sheet that fills in", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { sawLoading: boolean }).sawLoading = false;
    new MutationObserver(() => {
      if (document.body.textContent?.includes("Loading latest details…"))
        (window as unknown as { sawLoading: boolean }).sawLoading = true;
    }).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  await open(page, 390, clientPath());
  await seedPayments(page);
  await page.goto(clientPath());
  const sheet = await openService(page, LONG);
  await sheet.getByRole("button", { name: "Edit payment" }).click();
  await expect(
    page.getByRole("dialog", { name: "Edit payment" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { sawLoading: boolean }).sawLoading,
    ),
  ).toBe(false);
  await closeDialog(page, page.getByRole("dialog", { name: "Edit payment" }));
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    /\/receivables\/[^/?]+\/payments\/[^/?]+$/,
    async (route) => {
      await held;
      await route.continue();
    },
  );
  const again = await openService(page, LONG);
  await again.getByRole("button", { name: "Edit payment" }).click();
  const loading = page.getByRole("dialog", { name: "Edit payment" });
  await expect(loading.getByText("Loading latest details…")).toBeVisible();
  release();
  await expect(loading.getByLabel("Payment amount (USD)")).toBeVisible();
});
