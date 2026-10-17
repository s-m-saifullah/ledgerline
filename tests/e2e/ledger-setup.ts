import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import type { Page, TestInfo } from "@playwright/test";
import { createDatabase } from "../../apps/api/src/db/client";
import { newId } from "../../packages/shared/src/index";

/** Shared setup for browser specs that build their own synthetic ledger. Import these instead of copying them. */

/** Reads `.env` and connects to the local database; refuses anything that is not local. */
export function connectLocalDatabase(suite: string) {
  const env = parseEnv(readFileSync(".env", "utf8"));
  const databaseUrl = env.DATABASE_URL;
  if (
    !databaseUrl ||
    !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname) ||
    !["/ledgerline", "/ledgerline_test"].includes(new URL(databaseUrl).pathname)
  )
    throw new Error(`${suite} require the local database.`);
  return { env, pool: createDatabase(databaseUrl).pool };
}

type Pool = ReturnType<typeof connectLocalDatabase>["pool"];

/** Creates a ledger owned by the local test owner and returns the owner's id. */
export async function createOwnerLedger(
  pool: Pool,
  env: Record<string, string | undefined>,
  ledgerId: string,
  name: string,
) {
  const owner = (
    await pool.query(
      "select id from users where email=$1 and deleted_at is null",
      [env.OWNER_EMAIL],
    )
  ).rows[0];
  if (!owner) throw new Error("Missing local test owner");
  await pool.query("insert into ledgers(id,name) values($1,$2)", [
    ledgerId,
    name,
  ]);
  await pool.query(
    "insert into ledger_members(id,ledger_id,user_id,role) values($1,$2,$3,'owner')",
    [newId(), ledgerId, owner.id],
  );
  return owner.id as string;
}

/**
 * Points the page at the synthetic ledger: the ledger list is mocked to just this ledger, requests
 * get a distinct client address (so the auth limiter keeps workers apart) and the theme is light.
 */
export async function prepareBrowser(
  page: Page,
  info: TestInfo,
  options: {
    ledgerId: string;
    name: string;
    timeZone?: string | null;
    /** First address in 203.0.113.x and how many addresses workers spread over. */
    forwarded: [first: number, spread: number];
  },
) {
  await page.route("**/api/v1/ledgers", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: options.ledgerId,
            name: options.name,
            timeZone: options.timeZone ?? null,
            version: 1,
            baseCurrency: "USD",
            role: "owner",
          },
        ],
      },
    }),
  );
  const [first, spread] = options.forwarded;
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `203.0.113.${first + (info.workerIndex % spread)}`,
  });
  await page.emulateMedia({ colorScheme: "light" });
}
