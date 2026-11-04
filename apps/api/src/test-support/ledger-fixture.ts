import { newId } from "@ledgerline/shared";
import { inArray, like, sql } from "drizzle-orm";
import { expect } from "vitest";
import type { buildApp } from "../app";
import type { Config } from "../config";
import type { Database } from "../db/client";
import {
  account as credentials,
  ledgerMembers,
  ledgers,
  session,
  twoFactor,
  user,
} from "../db/schema";

/**
 * A person with a ledger full of recognisable data, for the tests that must prove one person's ledger is
 * untouched by something done to another's (ADR 0048 isolation, ADR 0049 purge and clear).
 */
export const month = "2026-11";
export const day = "2026-11-02";

export type Person = {
  name: string;
  id: string;
  ledgerId: string;
  cookie: string;
  marker: string;
  /** The real ids of the person's rows, by the name routes use for them (`accountId`, `categoryId`, ...). */
  ids: Record<string, string>;
  /** Everything that identifies the person: used to look for leaks in another person's answers. */
  secrets: string[];
};

/**
 * Helpers bound to one app: sign in, call a route, give a person a row in every kind of ledger data through the
 * real routes, fingerprint a ledger's tables, and wipe the people a suite made (`emailLike` matches their emails).
 */
export function ledgerFixture({
  app,
  config,
  db,
  mailbox,
  emailLike,
}: {
  app: Awaited<ReturnType<typeof buildApp>>;
  config: Config;
  db: Database;
  mailbox: (name: string) => string;
  emailLike: string;
}) {
  let nextAddress = 1;
  async function signIn(email: string, password: string) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/sign-in/email",
      headers: {
        origin: config.APP_URL,
        "x-forwarded-for": `198.51.100.${(nextAddress++ % 250) + 1}`,
      },
      payload: { email, password },
    });
    expect(response.statusCode, response.body).toBe(200);
    const header = response.headers["set-cookie"];
    return (Array.isArray(header) ? header : [String(header ?? "")])
      .map((value) => value.split(";")[0])
      .join("; ");
  }
  const send = (
    method: string,
    path: string,
    cookie: string,
    payload?: unknown,
  ) =>
    app.inject({
      method: method as "GET",
      url: path,
      headers: {
        origin: config.APP_URL,
        cookie,
        "idempotency-key": newId(),
      },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  /** A write that must succeed: the real route, as the person, in their own ledger. */
  async function make(
    person: { cookie: string; ledgerId: string },
    method: string,
    path: string,
    payload: unknown,
  ) {
    const response = await send(
      method,
      `/api/v1/ledgers/${person.ledgerId}${path}`,
      person.cookie,
      payload,
    );
    expect(
      response.statusCode,
      `${method} ${path}: ${response.body}`,
    ).toBeLessThan(300);
    return response.json();
  }

  /** Gives a person a recognisable row in every kind of ledger data, made through the real routes. */
  async function seed(person: Person) {
    const mark = person.marker;
    const usd = (amount: number) => ({ amount, currency: "USD" });
    const a1 = await make(person, "POST", "/accounts", {
      name: `${mark} checking`,
      type: "bank",
      openingBalance: usd(100000),
    });
    const a2 = await make(person, "POST", "/accounts", {
      name: `${mark} savings`,
      type: "savings",
      openingBalance: usd(50000),
    });
    const expense = await make(person, "POST", "/categories", {
      name: `${mark} food`,
      kind: "expense",
    });
    const income = await make(person, "POST", "/categories", {
      name: `${mark} pay`,
      kind: "income",
    });
    const tag = await make(person, "POST", "/tags", { name: `${mark} tag` });
    const contact = await make(person, "POST", "/contacts", {
      name: `${mark} client`,
    });
    const r1 = await make(person, "POST", "/receivables", {
      contactId: contact.id,
      description: `${mark} job one`,
      serviceDate: day,
      amount: usd(5000),
    });
    const payment = await make(
      person,
      "POST",
      `/receivables/${r1.id}/payments`,
      {
        amount: usd(2000),
        accountId: a1.id,
        categoryId: income.id,
        date: day,
        expectedReceivableVersion: r1.version,
      },
    );
    // A client-level payment applies across all of a client's open services, so it gets a client of its own.
    const other = await make(person, "POST", "/contacts", {
      name: `${mark} second client`,
    });
    const r2 = await make(person, "POST", "/receivables", {
      contactId: other.id,
      description: `${mark} job two`,
      serviceDate: day,
      amount: usd(4000),
    });
    const receipt = await make(
      person,
      "POST",
      `/contacts/${other.id}/receipts`,
      {
        amount: usd(1000),
        accountId: a1.id,
        categoryId: income.id,
        date: day,
        expectedAllocations: [
          { receivableId: r2.id, expectedVersion: r2.version, applied: 1000 },
        ],
      },
    );
    const transaction = await make(person, "POST", "/transactions", {
      accountId: a1.id,
      categoryId: expense.id,
      kind: "expense",
      date: day,
      amount: usd(-1500),
      payee: `${mark} shop`,
      note: `${mark} note`,
      tagIds: [tag.id],
    });
    await make(person, "POST", "/transactions", {
      accountId: a1.id,
      categoryId: null,
      kind: "expense",
      date: day,
      amount: usd(-2000),
      payee: `${mark} split shop`,
      note: null,
      splits: [
        { categoryId: expense.id, amount: usd(-1200), note: null },
        { categoryId: expense.id, amount: usd(-800), note: null },
      ],
    });
    const transfer = await make(person, "POST", "/transfers", {
      fromAccountId: a1.id,
      toAccountId: a2.id,
      amount: usd(500),
      date: day,
    });
    const budget = await make(person, "PUT", "/budgets", {
      categoryId: expense.id,
      month,
      amount: usd(20000),
      rollover: false,
    });
    await make(person, "PATCH", "", { timeZone: "UTC", expectedVersion: 1 });
    const rule = await make(person, "POST", "/recurring-rules", {
      title: `${mark} rent`,
      kind: "expense",
      accountId: a1.id,
      toAccountId: null,
      categoryId: expense.id,
      amount: usd(-30000),
      receivedAmount: null,
      bonus: null,
      payee: null,
      note: null,
      frequency: "month",
      interval: 1,
      startDate: "2026-12-01",
      endDate: null,
    });
    const currency = await make(person, "POST", "/currencies", { code: "EUR" });
    const rate = await make(person, "PUT", "/exchange-rates", {
      code: "EUR",
      date: day,
      rate: "1.25",
    });
    const batch = await make(person, "POST", "/imports", {
      accountId: a1.id,
      rows: [
        {
          line: 1,
          date: day,
          time: null,
          kind: "expense",
          amount: 700,
          categoryId: expense.id,
          payee: `${mark} import`,
          note: null,
          status: "cleared",
          sourceId: null,
        },
      ],
      sourceName: null,
    });
    person.ids = {
      accountId: a1.id,
      fromAccountId: a1.id,
      toAccountId: a2.id,
      categoryId: expense.id,
      destinationCategoryId: income.id,
      parentId: expense.id,
      tagId: tag.id,
      contactId: contact.id,
      receivableId: r1.id,
      paymentId: payment.id,
      receiptId: receipt.receiptId ?? receipt.id,
      transactionId: transaction.id,
      transferId: transfer.transferId ?? transfer.id,
      budgetId: budget.id,
      ruleId: rule.id,
      currencyId: currency.id,
      rateId: rate.id,
      batchId: batch.batch.id,
    };
    person.secrets = [
      person.id,
      person.ledgerId,
      mailbox(person.name),
      mark,
      ...Object.values(person.ids),
    ];
  }

  /** Everything stored for one ledger, as one fingerprint per table. Any write that reached it changes it. */
  async function fingerprint(ledgerId: string) {
    const tables = await db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='ledger_id' ORDER BY table_name`,
    );
    const result: Record<string, string> = {};
    for (const { table_name: name } of tables.rows) {
      const found = await db.execute<{ hash: string }>(
        sql`SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) AS hash FROM ${sql.identifier(name)} t WHERE t.ledger_id = ${ledgerId}`,
      );
      result[name] = found.rows[0]?.hash ?? "";
    }
    const own = await db.execute<{ hash: string }>(
      sql`SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) AS hash FROM ledgers t WHERE t.id = ${ledgerId}`,
    );
    result.ledgers = own.rows[0]?.hash ?? "";
    return result;
  }

  async function wipe() {
    const found = await db
      .select({ id: user.id })
      .from(user)
      .where(like(user.email, emailLike));
    const ids = found.map((person) => person.id);
    if (!ids.length) return;
    const members = await db
      .select({ ledgerId: ledgerMembers.ledgerId })
      .from(ledgerMembers)
      .where(inArray(ledgerMembers.userId, ids));
    const ledgerIds = members.map((member) => member.ledgerId);
    await db.transaction(async (tx) => {
      // Triggers off for this clean-up only: it removes rows for good, in any order.
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      const tables = await tx.execute<{ table_name: string }>(
        sql`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='ledger_id'`,
      );
      for (const { table_name: name } of tables.rows)
        if (ledgerIds.length)
          await tx.execute(
            sql`DELETE FROM ${sql.identifier(name)} WHERE ledger_id IN (${sql.join(
              ledgerIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          );
      await tx.delete(twoFactor).where(inArray(twoFactor.userId, ids));
      await tx.delete(session).where(inArray(session.userId, ids));
      await tx.delete(credentials).where(inArray(credentials.userId, ids));
      if (ledgerIds.length)
        await tx.delete(ledgers).where(inArray(ledgers.id, ledgerIds));
      await tx.delete(user).where(inArray(user.id, ids));
    });
  }
  return { signIn, send, make, seed, fingerprint, wipe };
}
