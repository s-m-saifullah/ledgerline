import { expect, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import { chooseCategory } from "./category-picker";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";

const { env, pool } = connectLocalDatabase("Loan browser tests");
let ledgerId = "",
  accountId = "";
const root = () => `/api/v1/ledgers/${ledgerId}`;
test.beforeEach(async ({ page }, info) => {
  ledgerId = newId();
  accountId = newId();
  await createOwnerLedger(
    pool,
    env,
    ledgerId,
    `E2E loans ledger ${info.project.name}`,
  );
  await pool.query(
    "insert into accounts(id,ledger_id,name,type,opening_balance) values($1,$2,'Checking','bank',100000)",
    [accountId, ledgerId],
  );
  await pool.query(
    "insert into categories(id,ledger_id,name,kind) values($1,$2,'Bad debt','expense')",
    [newId(), ledgerId],
  );
  await prepareBrowser(page, info, {
    ledgerId,
    name: "Synthetic loans ledger",
    forwarded: [60, 70],
  });
});
test.afterEach(async () => {
  const c = await pool.connect();
  try {
    await c.query("begin");
    for (const table of [
      "transactions",
      "accounts",
      "contacts",
      "categories",
      "ledger_members",
    ])
      await c.query(`update ${table} set deleted_at=now() where ledger_id=$1`, [
        ledgerId,
      ]);
    await c.query(
      "update ledgers set deleted_at=now() where id=$1 and name like 'E2E loans ledger %'",
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

/** A person's loan action: an inline button on wide screens, an item in the menu on phones. */
async function loanAction(page: Page, name: string) {
  const inline = page
    .getByRole("button", { name, exact: true })
    .filter({ visible: true });
  const trigger = page.getByRole("button", { name: /^More actions for/ });
  await inline.or(trigger).first().waitFor();
  if ((await inline.count()) > 0) return inline.first().click();
  await trigger.click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
async function balance(page: Page) {
  const response = await page.request.get(`${root()}/accounts/${accountId}`);
  expect(response.status()).toBe(200);
  return (await response.json()).balance.amount as number;
}
const dialog = (page: Page) => page.getByRole("dialog");
const balances = (page: Page) =>
  page.getByRole("region", { name: "Balance and activity" });
/** Add a person and a loan from the list: who, what happened and the amount. */
async function addLoan(
  page: Page,
  what: "I lent money" | "I borrowed money" | "A loan I already had",
  amount: string,
) {
  await page.getByRole("button", { name: "Add loan", exact: true }).click();
  await dialog(page)
    .getByLabel(/^Who(?! owes)/)
    .selectOption({ label: "A new person…" });
  await dialog(page).getByLabel("Name", { exact: true }).fill("Sam");
  await dialog(page)
    .getByLabel(/^What happened/)
    .selectOption({ label: what });
  await dialog(page)
    .getByLabel(/^Amount/)
    .fill(amount);
  await dialog(page)
    .getByRole("button", {
      name:
        what === "I lent money"
          ? "Lend"
          : what === "I borrowed money"
            ? "Borrow"
            : "Save existing loan",
      exact: true,
    })
    .click();
}

test("lend, repay and waive keep exact balances, and an existing loan moves no money", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/loans");
  await expect(
    page.getByRole("heading", { name: "Loans", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Keep track of loans")).toBeVisible();

  // An existing loan for a new person: they already owe 50.00, and no account changes.
  await addLoan(page, "A loan I already had", "50.00");
  await expect(
    page.getByRole("heading", { name: "Sam", exact: true }),
  ).toBeVisible();
  await expect(balances(page)).toContainText("Sam owes you");
  await expect(balances(page)).toContainText("$50.00");
  await expect(balances(page)).toContainText("Before Ledgerline");
  expect(await balance(page)).toBe(100000);

  // A mistake in the starting balance can be fixed: flip it to "you owe 40.00", then back.
  await balances(page)
    .getByRole("button", {
      name: "Change the balance from before Ledgerline (USD)",
    })
    .click();
  await dialog(page).getByLabel("Who owes whom").selectOption("owedByMe");
  await dialog(page)
    .getByLabel(/^Amount/)
    .fill("40.00");
  await dialog(page)
    .getByRole("button", { name: "Save existing loan" })
    .click();
  await expect(balances(page)).toContainText("You owe Sam");
  await expect(balances(page)).toContainText("$40.00");
  await balances(page)
    .getByRole("button", {
      name: "Change the balance from before Ledgerline (USD)",
    })
    .click();
  await dialog(page).getByLabel("Who owes whom").selectOption("owedToMe");
  await dialog(page)
    .getByLabel(/^Amount/)
    .fill("50.00");
  await dialog(page)
    .getByRole("button", { name: "Save existing loan" })
    .click();
  await expect(balances(page)).toContainText("Sam owes you");
  await expect(balances(page)).toContainText("$50.00");
  expect(await balance(page)).toBe(100000);

  // Lend 20.00 from Checking.
  await loanAction(page, "Lend money");
  await dialog(page)
    .getByLabel(/^Amount/)
    .fill("20.00");
  await dialog(page).getByRole("button", { name: "Lend", exact: true }).click();
  await expect(balances(page)).toContainText("$70.00");
  expect(await balance(page)).toBe(98000);

  // Repay 30.00 back into Checking; a larger repayment is refused in the form.
  await loanAction(page, "Record repayment");
  await dialog(page)
    .getByLabel(/^Amount/)
    .fill("100.00");
  await dialog(page)
    .getByRole("button", { name: "Record repayment", exact: true })
    .click();
  await expect(dialog(page).getByRole("alert")).toContainText(
    "more than what is open",
  );
  await dialog(page)
    .getByLabel(/^Amount/)
    .fill("30.00");
  await dialog(page)
    .getByRole("button", { name: "Record repayment", exact: true })
    .click();
  await expect(balances(page)).toContainText("$40.00");
  expect(await balance(page)).toBe(101000);

  // The list shows the balance; Home links here; Accounts and Clients do not list Sam.
  await page.getByRole("button", { name: "All people", exact: true }).click();
  await expect(
    page.locator(".client-card").filter({ hasText: "Sam" }),
  ).toContainText("Owes you");
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Lent out. Open Loans" }),
  ).toContainText("$40.00");
  await page.goto("/accounts");
  await expect(page.getByText("Checking").first()).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Sam");
  await page.goto("/clients");
  await expect(
    page.getByRole("heading", { name: "Clients", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".client-card")).toHaveCount(0);

  // Waive the rest: it becomes an expense and the balance settles.
  await page.goto("/loans");
  await page.locator(".client-card").filter({ hasText: "Sam" }).click();
  await loanAction(page, "Waive what is left");
  await chooseCategory(dialog(page), "Expense category", "Bad debt");
  await dialog(page)
    .getByRole("button", { name: "Waive", exact: true })
    .click();
  await expect(balances(page)).toContainText("Settled");
  expect(await balance(page)).toBe(101000);
});

test("borrowing makes a negative balance that you repay, and a person can be renamed and archived, on a narrow phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await signIn(page);
  await page.goto("/loans");
  await addLoan(page, "I borrowed money", "15.00");
  await expect(balances(page)).toContainText("You owe Sam");
  await expect(balances(page)).toContainText("$15.00");
  expect(await balance(page)).toBe(101500);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await loanAction(page, "Record repayment");
  await expect(dialog(page)).toContainText("You pay Sam back");
  await dialog(page)
    .getByLabel(/^Amount/)
    .fill("15.00");
  await dialog(page)
    .getByRole("button", { name: "Record repayment", exact: true })
    .click();
  await expect(balances(page)).toContainText("Settled");
  expect(await balance(page)).toBe(100000);

  await loanAction(page, "Rename");
  await dialog(page).getByLabel("Name", { exact: true }).fill("Samira");
  await dialog(page)
    .getByRole("button", { name: "Save name", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Samira", exact: true }),
  ).toBeVisible();
  await loanAction(page, "Archive");
  await dialog(page)
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Samira (archived)" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^More actions for/ }).click();
  await expect(
    page.getByRole("menuitem", { name: "Unarchive", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("menuitem", {
      name: "Borrow money",
      exact: true,
    }),
  ).toBeDisabled();
});
