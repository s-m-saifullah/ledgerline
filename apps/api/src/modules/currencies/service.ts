import {
  type CurrencyList,
  type ExchangeRate,
  exchangeRateSchema,
  formatRate,
  type PinnedCurrency,
  parseRate,
  pinnedCurrencySchema,
  type RefreshRatesResult,
  type SetExchangeRate,
} from "@ledgerline/shared";
import type { Database, DatabaseConnection } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { requireLedgerRead, requireLedgerWrite } from "../ledgers/service";
import {
  runFinancialWrite,
  type WriteContext,
  type WriteIdentity,
  type WriteResponse,
} from "../writes/service";
import { nextVersion, requireVersionUpdate } from "../writes/version";
import type { RateFetcher } from "./provider";
import {
  type CurrencyRow,
  currencyRepository,
  type RateRow,
  rateRepository,
} from "./repo";

export function rateDto(row: RateRow): ExchangeRate {
  return exchangeRateSchema.parse({
    id: row.id,
    ledgerId: row.ledgerId,
    code: row.code,
    date: row.date,
    rate: formatRate(parseRate(row.rate)),
    source: row.source,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
function currencyDto(
  row: CurrencyRow,
  latest: RateRow | undefined,
): PinnedCurrency {
  return pinnedCurrencySchema.parse({
    id: row.id,
    ledgerId: row.ledgerId,
    code: row.code,
    version: row.version,
    latestRate: latest ? rateDto(latest) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
function conflict(field: string, message: string): never {
  throw new ApiProblem(409, "Conflict", message, [{ field, message }]);
}
const tomorrow = () =>
  new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

export async function listCurrencies(
  db: Database,
  actorId: string,
  ledgerId: string,
): Promise<CurrencyList> {
  const ledger = await requireLedgerRead(db, actorId, ledgerId);
  const rows = await currencyRepository(db, ledgerId).list();
  const rates = rateRepository(db, ledgerId);
  return {
    baseCurrency: ledger.baseCurrency,
    items: await Promise.all(
      rows.map(async (row) => currencyDto(row, await rates.latest(row.code))),
    ),
  };
}
export async function listRates(
  db: Database,
  actorId: string,
  ledgerId: string,
  code: string,
  limit: number,
) {
  await requireLedgerRead(db, actorId, ledgerId);
  const rows = await rateRepository(db, ledgerId).list(code, limit);
  return { items: rows.map(rateDto) };
}

/**
 * The rate to use for an entry on a date: the newest stored rate on or before it, or exactly 1
 * for the base currency. Throws a 409 asking for a manual rate when none exists, so a caller
 * never saves a guessed amount (ADR 0022).
 */
export async function lookupRate(
  db: DatabaseConnection,
  ledgerId: string,
  code: string,
  baseCurrency: string,
  date: string,
): Promise<{ rate: string; date: string; source: "api" | "manual" | "base" }> {
  if (code === baseCurrency) return { rate: "1", date, source: "base" };
  const row = await rateRepository(db, ledgerId).onOrBefore(code, date);
  if (!row)
    throw new ApiProblem(
      409,
      "Conflict",
      `No ${code} rate is available on or before this date. Enter one in Currencies.`,
      [{ field: "currency", message: `Enter a ${code} rate for this date.` }],
    );
  return { rate: rateDto(row).rate, date: row.date, source: row.source };
}

function write(
  db: Database,
  identity: WriteIdentity,
  operation: string,
  request: Parameters<typeof runFinancialWrite>[1]["request"],
  mutate: (context: WriteContext) => Promise<WriteResponse>,
) {
  return runFinancialWrite(
    db,
    { ...identity, operation, request },
    async (context) => {
      await currencyRepository(context.tx, context.ledgerId).lock();
      return mutate(context);
    },
  );
}
async function baseOf(context: WriteContext) {
  return (
    await requireLedgerWrite(context.tx, context.actorId, context.ledgerId)
  ).baseCurrency;
}

export function pinCurrency(
  db: Database,
  identity: WriteIdentity,
  body: { code: string },
) {
  return write(db, identity, "POST currencies", body, async (context) => {
    if (body.code === (await baseOf(context)))
      conflict("code", "The base currency is always available.");
    const repo = currencyRepository(context.tx, context.ledgerId);
    if (await repo.findByCode(body.code))
      conflict("code", "This currency is already added.");
    const row = await repo.create(body.code);
    if (!row) throw new Error("Currency was not created");
    return { status: 201, body: currencyDto(row, undefined) };
  });
}
export function unpinCurrency(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: { expectedVersion: number },
) {
  return write(
    db,
    identity,
    `DELETE currencies/${id.toLowerCase()}`,
    body,
    async (context) => {
      const repo = currencyRepository(context.tx, context.ledgerId);
      const current = await repo.find(id);
      if (!current)
        throw new ApiProblem(404, "Not found", "Currency not found.");
      const version = nextVersion(current.version, body.expectedVersion);
      requireVersionUpdate(
        await repo.update(
          id,
          body.expectedVersion,
          { deletedAt: new Date() },
          version,
        ),
      );
      return { status: 204, body: null };
    },
  );
}

function rateWrite(
  db: Database,
  identity: WriteIdentity,
  operation: string,
  request: Parameters<typeof runFinancialWrite>[1]["request"],
  mutate: (
    context: WriteContext,
    rates: ReturnType<typeof rateRepository>,
  ) => Promise<WriteResponse>,
) {
  return write(db, identity, operation, request, async (context) => {
    const rates = rateRepository(context.tx, context.ledgerId);
    await rates.lock();
    return mutate(context, rates);
  });
}
export function setRate(
  db: Database,
  identity: WriteIdentity,
  body: SetExchangeRate,
) {
  const { expectedVersion, ...rest } = body;
  const request =
    expectedVersion === undefined ? rest : { ...rest, expectedVersion };
  return rateWrite(
    db,
    identity,
    "PUT exchange-rates",
    request,
    async (context, rates) => {
      if (body.date > tomorrow())
        conflict("date", "A rate cannot be set for a future date.");
      const base = await baseOf(context);
      if (body.code === base)
        conflict("code", "The base currency always has a rate of 1.");
      if (
        !(await currencyRepository(context.tx, context.ledgerId).findByCode(
          body.code,
        ))
      )
        conflict("code", "Add this currency before setting its rate.");
      const existing = await rates.findForDate(body.code, body.date);
      if (expectedVersion === undefined) {
        if (existing)
          conflict(
            "date",
            "A rate already exists for this date. Reload and edit it.",
          );
        const created = await rates.create({
          code: body.code,
          date: body.date,
          rate: body.rate,
          source: "manual",
        });
        if (!created) throw new Error("Rate was not created");
        return { status: 201, body: rateDto(created) };
      }
      if (!existing) throw new ApiProblem(404, "Not found", "Rate not found.");
      const version = nextVersion(existing.version, expectedVersion);
      return {
        status: 200,
        body: rateDto(
          requireVersionUpdate(
            await rates.update(
              existing.id,
              expectedVersion,
              { rate: body.rate, source: "manual" },
              version,
            ),
          ),
        ),
      };
    },
  );
}
export function deleteRate(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: { expectedVersion: number },
) {
  return rateWrite(
    db,
    identity,
    `DELETE exchange-rates/${id.toLowerCase()}`,
    body,
    async (_context, rates) => {
      const current = await rates.find(id);
      if (!current) throw new ApiProblem(404, "Not found", "Rate not found.");
      const version = nextVersion(current.version, body.expectedVersion);
      requireVersionUpdate(
        await rates.update(
          id,
          body.expectedVersion,
          { deletedAt: new Date() },
          version,
        ),
      );
      return { status: 204, body: null };
    },
  );
}

/**
 * Fetch current rates for the pinned currencies (or one of them). The network calls happen
 * before the database write, never inside it. Manual rates are kept as they are.
 */
export async function refreshRates(
  db: Database,
  identity: WriteIdentity,
  body: { code?: string | undefined },
  fetchRate: RateFetcher,
) {
  const planned = await db.transaction(async (tx) => {
    const ledger = await requireLedgerWrite(
      tx,
      identity.actorId,
      identity.ledgerId,
    );
    const pinned = (await currencyRepository(tx, identity.ledgerId).list()).map(
      (row) => row.code,
    );
    if (body.code && !pinned.includes(body.code))
      conflict("code", "Add this currency before refreshing its rate.");
    return {
      base: ledger.baseCurrency,
      codes: body.code ? [body.code] : pinned,
    };
  });
  const fetched = await Promise.all(
    planned.codes.map(
      async (code) => [code, await fetchRate(code, planned.base)] as const,
    ),
  );
  const request = body.code ? { code: body.code } : {};
  return rateWrite(
    db,
    identity,
    "POST exchange-rates/refresh",
    request,
    async (_context, rates) => {
      const result: RefreshRatesResult = {
        updated: 0,
        keptManual: 0,
        failed: [],
      };
      for (const [code, found] of fetched) {
        if (!found || found.date > tomorrow()) {
          result.failed.push(code);
          continue;
        }
        const existing = await rates.findForDate(code, found.date);
        if (!existing) {
          await rates.create({
            code,
            date: found.date,
            rate: found.rate,
            source: "api",
          });
          result.updated++;
        } else if (existing.source === "manual") {
          result.keptManual++;
        } else if (rateDto(existing).rate !== found.rate) {
          requireVersionUpdate(
            await rates.update(
              existing.id,
              existing.version,
              { rate: found.rate },
              nextVersion(existing.version, existing.version),
            ),
          );
          result.updated++;
        }
      }
      return { status: 200, body: result };
    },
  );
}

/**
 * The newest stored rate for each currency (the base currency is not included), used to value
 * balances today (ADR 0022). A currency with no stored rate is absent from the result.
 */
export async function latestRates(
  db: DatabaseConnection,
  ledgerId: string,
  codes: string[],
) {
  const rates = rateRepository(db, ledgerId);
  const found = new Map<string, string>();
  for (const code of [...new Set(codes)]) {
    const row = await rates.latest(code);
    if (row) found.set(code, rateDto(row).rate);
  }
  return found;
}

/** An account may use the base currency or any currency the ledger has added. */
export async function requireUsableCurrency(
  db: DatabaseConnection,
  ledgerId: string,
  baseCurrency: string,
  code: string,
) {
  if (code === baseCurrency) return;
  if (!(await currencyRepository(db, ledgerId).findByCode(code)))
    conflict(
      "openingBalance.currency",
      `Add ${code} in Currencies before using it for an account.`,
    );
}
