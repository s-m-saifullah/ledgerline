import { expect, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";

// ADR 0039 spacing rule on the 4 px grid: the focus ring reaches 4 px beyond a control, so the text above a
// field must sit at least 8 px away. Opens the main forms at three widths and measures every field.
const { env, pool } = connectLocalDatabase("Spacing browser tests");
let ledgerId = "";
const MIN_GAP = 8;

test.afterAll(async () => {
  if (ledgerId) {
    for (const table of ["transactions", "tags", "accounts", "categories"])
      await pool.query(`DELETE FROM ${table} WHERE ledger_id=$1`, [ledgerId]);
    await pool.query("DELETE FROM ledger_members WHERE ledger_id=$1", [
      ledgerId,
    ]);
    await pool.query("DELETE FROM ledgers WHERE id=$1", [ledgerId]);
  }
  await pool.end();
});

/** Gaps (px) between each field's top edge and the nearest text above it that overlaps it horizontally. */
async function fieldGaps(page: Page) {
  return page.evaluate(() => {
    const visible = (element: Element) => {
      // The content of a closed disclosure is not on screen, whatever box the browser still reports for it.
      const closed = element.closest("details:not([open])");
      if (closed && element.closest("summary")?.parentElement !== closed)
        return false;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        box.width > 0 &&
        box.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      );
    };
    const root =
      document.querySelector("dialog[open], [role=dialog]") ??
      document.querySelector("main") ??
      document.body;
    const controls = Array.from(
      root.querySelectorAll<HTMLInputElement>("input, select, textarea"),
    ).filter(
      (control) =>
        visible(control) &&
        !["checkbox", "radio", "hidden"].includes(control.type),
    );
    const texts = Array.from(
      root.querySelectorAll(
        "label, p, legend, h1, h2, h3, span, summary, small, dt, strong",
      ),
    ).filter(
      (text) =>
        visible(text) &&
        Array.from(text.childNodes).some(
          (node) =>
            node.nodeType === 3 && (node.textContent ?? "").trim() !== "",
        ),
    );
    const found: { field: string; text: string; gap: number }[] = [];
    for (const control of controls) {
      const box = control.getBoundingClientRect();
      let nearest: { text: string; gap: number } | undefined;
      for (const text of texts) {
        if (text.contains(control) || control.contains(text)) continue;
        const other = text.getBoundingClientRect();
        const overlap =
          Math.min(box.right, other.right) - Math.max(box.left, other.left);
        const gap = box.top - other.bottom;
        if (overlap < 4 || gap < -1 || gap > 40) continue;
        if (!nearest || gap < nearest.gap)
          nearest = { text: (text.textContent ?? "").trim().slice(0, 40), gap };
      }
      if (nearest)
        found.push({
          field: `${control.tagName.toLowerCase()}#${control.id || control.name}`,
          ...nearest,
        });
    }
    return found;
  });
}

async function expectSpaced(page: Page, scene: string, width: number) {
  const tight = (await fieldGaps(page)).filter((entry) => entry.gap < MIN_GAP);
  expect(tight, `${scene} at ${width}px: text too close above a field`).toEqual(
    [],
  );
}

test("fields keep 8 px between their label and the focus ring on every main form", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  test.setTimeout(240000);
  ledgerId = newId();
  await createOwnerLedger(pool, env, ledgerId, "E2E spacing ledger");
  const checking = newId();
  const food = newId();
  await pool.query(
    "INSERT INTO accounts (id,ledger_id,name,type,opening_balance) VALUES ($1,$3,'Checking','bank',100000),($2,$3,'Savings','bank',5000)",
    [checking, newId(), ledgerId],
  );
  await pool.query(
    "INSERT INTO categories (id,ledger_id,name,kind) VALUES ($1,$2,'Food','expense')",
    [food, ledgerId],
  );
  await pool.query(
    "INSERT INTO transactions (id,ledger_id,account_id,category_id,kind,date,amount,base_amount) VALUES ($1,$2,$3,$4,'expense',$5,-2500,-2500)",
    [newId(), ledgerId, checking, food, new Date().toISOString().slice(0, 10)],
  );
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "E2E spacing ledger",
    forwarded: [90, 20],
  });
  await signIn(page);

  const add = (p: Page) =>
    p.getByRole("button", { name: /Add transaction/ }).first();
  const scenes: [string, (p: Page) => Promise<void>][] = [
    [
      "two-factor password step",
      async (p) => {
        await p.goto("/settings");
        await p.getByRole("button", { name: "Set up two-factor" }).click();
      },
    ],
    [
      "settings",
      async (p) => {
        await p.goto("/settings");
        await expect(p.getByText("Your data")).toBeVisible();
      },
    ],
    [
      "transaction filters",
      async (p) => {
        await p.goto("/transactions");
        await p.getByRole("button", { name: /^Filters/ }).click();
      },
    ],
    [
      "quick add with more details",
      async (p) => {
        await p.goto("/");
        await add(p).click();
        await p.getByText("More details", { exact: true }).click();
      },
    ],
    [
      "quick add split",
      async (p) => {
        await p.goto("/");
        await add(p).click();
        await p.getByText("Split across categories").click();
      },
    ],
    [
      "transfer",
      async (p) => {
        await p.goto("/");
        await add(p).click();
        await p.getByText("Transfer", { exact: true }).click();
        await p
          .getByText(/^More\s/)
          .first()
          .click();
      },
    ],
    [
      "edit transaction",
      async (p) => {
        await p.goto("/transactions");
        await p
          .getByRole("button", { name: /^Open transaction/ })
          .first()
          .click();
      },
    ],
    [
      "add account",
      async (p) => {
        await p.goto("/accounts");
        await p
          .getByRole("button", { name: /Add (your first )?account/ })
          .first()
          .click();
      },
    ],
    [
      "edit account",
      async (p) => {
        await p.goto("/accounts");
        await p.getByRole("button", { name: "Edit Checking" }).click();
      },
    ],
    ["tags", async (p) => void (await p.goto("/tags"))],
    ["clients", async (p) => void (await p.goto("/clients"))],
    ["loans", async (p) => void (await p.goto("/loans"))],
    ["import", async (p) => void (await p.goto("/import"))],
  ];
  for (const [scene, open] of scenes)
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page);
      await page.waitForTimeout(200);
      await expectSpaced(page, scene, width);
    }
});

test("sign-in and the two-factor code step keep the same spacing", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await page.route("**/api/v1/auth/sign-in/email", (route) =>
    route.fulfill({ json: { twoFactorRedirect: true } }),
  );
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
    await expectSpaced(page, "sign in", width);
    await page.getByLabel("Email address").fill("you@example.com");
    await page
      .getByLabel("Password", { exact: true })
      .fill("a-long-password-12");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Two-factor code" }),
    ).toBeVisible();
    await expectSpaced(page, "two-factor code step", width);
  }
  await context.close();
});

test("on a phone the edit dialog keeps Close, the trash icon and Save on one row", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  ledgerId = ledgerId || newId();
  const made = ledgerId;
  const ledger = await pool.query("select 1 from ledgers where id=$1", [made]);
  if (!ledger.rowCount) {
    await createOwnerLedger(pool, env, made, "E2E spacing ledger");
    const account = newId();
    const category = newId();
    await pool.query(
      "INSERT INTO accounts (id,ledger_id,name,type,opening_balance) VALUES ($1,$2,'Checking','bank',100000)",
      [account, made],
    );
    await pool.query(
      "INSERT INTO categories (id,ledger_id,name,kind) VALUES ($1,$2,'Food','expense')",
      [category, made],
    );
    await pool.query(
      "INSERT INTO transactions (id,ledger_id,account_id,category_id,kind,date,amount,base_amount) VALUES ($1,$2,$3,$4,'expense',$5,-2500,-2500)",
      [newId(), made, account, category, new Date().toISOString().slice(0, 10)],
    );
  }
  await prepareBrowser(page, testInfo, {
    ledgerId: made,
    name: "E2E spacing ledger",
    forwarded: [110, 20],
  });
  await signIn(page);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/transactions");
    await page
      .getByRole("button", { name: /^Open transaction/ })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    const remove = dialog.getByRole("button", { name: "Delete transaction" });
    const close = dialog.getByRole("button", { name: "Close", exact: true });
    const save = dialog.getByRole("button", { name: "Save changes" });
    const [r, c, s] = await Promise.all([
      remove.boundingBox(),
      close.boundingBox(),
      save.boundingBox(),
    ]);
    expect(r && c && s).toBeTruthy();
    // One row, a square 48 px icon button, and the primary button gets the room that is left.
    expect(Math.abs((r?.y ?? 0) - (c?.y ?? 99))).toBeLessThan(2);
    expect(Math.abs((r?.y ?? 0) - (s?.y ?? 99))).toBeLessThan(2);
    expect(r?.width ?? 0).toBeLessThanOrEqual(48);
    expect(r?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(s?.width ?? 0).toBeGreaterThan(c?.width ?? 0);
    await expect(remove).toHaveAttribute("title", "Delete transaction");
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/transactions");
  await page
    .getByRole("button", { name: /^Open transaction/ })
    .first()
    .click();
  const desktopRemove = page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete transaction" });
  expect((await desktopRemove.boundingBox())?.width ?? 0).toBeGreaterThan(100);
});
