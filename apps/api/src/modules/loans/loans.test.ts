import { type Contact, type LoanResult, newId } from "@ledgerline/shared";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { readConfig } from "../../config";
import { createDatabase } from "../../db/client";
import { applyMigrations } from "../../db/migrate";
import {
  accounts,
  categories,
  contacts,
  account as credentials,
  ledgerMembers,
  ledgers,
  receivableEvents,
  receivables,
  session,
  transactions,
  user,
  writeReceipts,
} from "../../db/schema";
import { hashPassword } from "../auth/password";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("/ledgerline_test"))
  throw new Error("Loan tests require dedicated ledgerline_test.");
const config = readConfig({
  NODE_ENV: "test",
  DATABASE_URL: url,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "loans-test-secret-only-0000000-000000000000000000",
  OWNER_EMAIL: "loans@example.com",
  OWNER_PASSWORD: "Loans-test-password-0000000",
  OWNER_NAME: "Test owner",
});
const { db, pool } = createDatabase(url),
  app = await buildApp(db, config);
const ledgerId = newId(),
  other = newId(),
  foreign = newId(),
  ids = [ledgerId, other, foreign],
  users = [newId(), newId(), newId()];
let cookie = "",
  editor = "",
  accountId = "",
  expenseId = "",
  incomeId = "",
  client: Contact;
const base = (l = ledgerId) => `/api/v1/ledgers/${l}`;
const money = (amount: number) => ({ amount, currency: "USD" });
const headers = (actor = cookie, key = newId()) => ({
  cookie: actor,
  origin: config.APP_URL,
  "idempotency-key": key,
  "content-type": "application/json",
});
const read = (path: string, actor = cookie) =>
  app.inject({ url: base() + path, headers: { cookie: actor } });
const write = (
  path: string,
  body: unknown = {},
  method: "POST" | "PATCH" | "DELETE" = "POST",
  actor = cookie,
  key = newId(),
  ledger = ledgerId,
) =>
  app.inject({
    url: base(ledger) + path,
    method,
    headers: headers(actor, key),
    payload: JSON.stringify(body),
  });
async function balance() {
  return (await read(`/accounts/${accountId}`)).json().balance.amount as number;
}
async function clear() {
  await db.transaction(async (tx) => {
    await tx
      .delete(receivableEvents)
      .where(inArray(receivableEvents.ledgerId, ids));
    await tx.delete(transactions).where(inArray(transactions.ledgerId, ids));
    await tx.delete(receivables).where(inArray(receivables.ledgerId, ids));
    await tx.delete(accounts).where(inArray(accounts.ledgerId, ids));
    await tx.delete(contacts).where(inArray(contacts.ledgerId, ids));
  });
  await db.delete(categories).where(inArray(categories.ledgerId, ids));
  await db.delete(writeReceipts).where(inArray(writeReceipts.ledgerId, ids));
}
beforeAll(async () => {
  await applyMigrations(url);
  await db
    .insert(ledgers)
    .values(ids.map((id) => ({ id, name: "Synthetic loans suite" })));
  const password = await hashPassword(config.OWNER_PASSWORD);
  for (const [i, role] of (["owner", "editor", "viewer"] as const).entries()) {
    const id = users[i] as string,
      email = `loan-${role}-${id}@example.com`;
    await db.insert(user).values({ id, name: role, email });
    await db.insert(credentials).values({
      userId: id,
      accountId: id,
      providerId: "credential",
      password,
    });
    await db.insert(ledgerMembers).values({ userId: id, ledgerId, role });
  }
  await db
    .insert(ledgerMembers)
    .values({ userId: users[0] as string, ledgerId: other, role: "owner" });
  await app.ready();
  const cookies = [];
  for (const [i, role] of ["owner", "editor", "viewer"].entries()) {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/auth/sign-in/email",
      headers: { origin: config.APP_URL },
      payload: {
        email: `loan-${role}-${users[i]}@example.com`,
        password: config.OWNER_PASSWORD,
      },
    });
    expect(r.statusCode).toBe(200);
    const c = r.headers["set-cookie"];
    cookies.push(
      (Array.isArray(c) ? c : [c ?? ""]).map((v) => v.split(";")[0]).join("; "),
    );
  }
  [cookie, editor] = cookies as [string, string, string];
});
beforeEach(async () => {
  await clear();
  await db
    .update(ledgerMembers)
    .set({ role: "owner", deletedAt: null })
    .where(
      and(
        eq(ledgerMembers.ledgerId, ledgerId),
        eq(ledgerMembers.userId, users[0] as string),
      ),
    );
  accountId = newId();
  expenseId = newId();
  incomeId = newId();
  await db.insert(accounts).values({
    id: accountId,
    ledgerId,
    name: "Everyday",
    type: "bank",
    openingBalance: 1000,
  });
  await db.insert(categories).values([
    { id: expenseId, ledgerId, name: "Bad debt", kind: "expense" },
    { id: incomeId, ledgerId, name: "Debt waived", kind: "income" },
  ]);
  const r = await write("/contacts", {
    name: "Sam",
    phone: "+1 555 0100",
    email: "sam@example.com",
    note: "Synthetic",
  });
  expect(r.statusCode).toBe(201);
  client = r.json();
});
afterAll(async () => {
  await app.close();
  await clear();
  await db.delete(ledgerMembers).where(inArray(ledgerMembers.ledgerId, ids));
  await db.delete(ledgers).where(inArray(ledgers.id, ids));
  await db.delete(session).where(inArray(session.userId, users));
  await db.delete(credentials).where(inArray(credentials.userId, users));
  await db.delete(user).where(inArray(user.id, users));
  await pool.end();
});
const move = (kind: string, amount: number, extra: object = {}, who = client) =>
  write(`/contacts/${who.id}/loans/${kind}`, {
    accountId,
    amount: money(amount),
    date: "2026-10-07",
    ...extra,
  });
const loans = async (who = client) =>
  (await read(`/contacts/${who.id}/loans`)).json().items as {
    accountId: string;
    currency: string;
    openingBalance: { amount: number };
    balance: { amount: number };
    version: number;
  }[];
const owed = async () => (await loans())[0]?.balance.amount;

describe("lending and borrowing", () => {
  it("lends money as a transfer and shows what the client owes", async () => {
    const r = await move("lend", 300);
    expect(r.statusCode, r.body).toBe(201);
    const result = r.json() as LoanResult;
    expect(result.balance.balance.amount).toBe(300);
    expect(result.transferId).toBeTruthy();
    expect(await balance()).toBe(700);
    expect(await owed()).toBe(300);
    // A transfer is not income or spending.
    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.ledgerId, ledgerId));
    expect(rows.map((row) => row.kind)).toEqual(["transfer", "transfer"]);
  });
  it("keeps one balance per client and currency and nets lending against borrowing", async () => {
    await move("lend", 300);
    await move("borrow", 500);
    expect(await loans()).toHaveLength(1);
    expect(await owed()).toBe(-200);
    expect(await balance()).toBe(1200);
  });
  it("repays in the direction the balance points and never past what is open", async () => {
    await move("lend", 300);
    expect((await move("repay", 100)).statusCode).toBe(201);
    expect(await owed()).toBe(200);
    expect(await balance()).toBe(800);
    expect((await move("repay", 201)).statusCode).toBe(409);
    expect((await move("repay", 200)).statusCode).toBe(201);
    expect(await owed()).toBe(0);
    expect((await move("repay", 1)).statusCode).toBe(409);
    await move("borrow", 50);
    expect((await move("repay", 50)).statusCode).toBe(201);
    expect(await owed()).toBe(0);
    expect(await balance()).toBe(1000);
  });
  it("waives what is left as an expense, or as income when you owed", async () => {
    await move("lend", 300);
    const waive = (categoryId: string) =>
      write(`/contacts/${client.id}/loans/waive`, {
        currency: "USD",
        categoryId,
        date: "2026-10-08",
      });
    expect((await waive(incomeId)).statusCode).toBe(409);
    const r = await waive(expenseId);
    expect(r.statusCode, r.body).toBe(201);
    expect(await owed()).toBe(0);
    expect(await balance()).toBe(700);
    expect((await waive(expenseId)).statusCode).toBe(409);
    await move("borrow", 100);
    expect((await waive(expenseId)).statusCode).toBe(409);
    expect((await waive(incomeId)).statusCode).toBe(201);
    expect(await owed()).toBe(0);
    const entries = await db
      .select()
      .from(transactions)
      .where(eq(transactions.categoryId, incomeId));
    expect(entries[0]?.amount).toBe(100);
  });
  it("adds an existing loan without moving money in any account", async () => {
    const r = await write(`/contacts/${client.id}/loans/opening`, {
      amount: money(5000),
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(await owed()).toBe(5000);
    expect(await balance()).toBe(1000);
    expect(
      await db
        .select()
        .from(transactions)
        .where(eq(transactions.ledgerId, ledgerId)),
    ).toHaveLength(0);
    // Changing it needs its version; a stale one is refused.
    const loan = (await loans())[0];
    expect(
      (
        await write(`/contacts/${client.id}/loans/opening`, {
          amount: money(1),
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await write(`/contacts/${client.id}/loans/opening`, {
          amount: money(1),
          expectedVersion: (loan?.version ?? 0) + 1,
        })
      ).statusCode,
    ).toBe(409);
    const changed = await write(`/contacts/${client.id}/loans/opening`, {
      amount: money(-2500),
      expectedVersion: loan?.version,
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(await owed()).toBe(-2500);
    // Later money still adds to it.
    await move("repay", 500);
    expect(await owed()).toBe(-2000);
  });
  it("shows lent and borrowed money on Home without calling it a card or loan debt", async () => {
    await move("lend", 300);
    const other = (
      await write("/contacts", { name: "Alex" })
    ).json() as Contact;
    await move("borrow", 120, {}, other);
    const home = (await read("/home?month=2026-10")).json();
    expect(home.loans.lent.amount).toBe(300);
    expect(home.loans.borrowed.amount).toBe(120);
    // Net worth counts both (1000 - 300 + 120 in the bank, +300 owed to you, -120 owed by you).
    expect(home.netWorth.amount).toBe(1000);
    expect(home.liabilitiesOwed.amount).toBe(0);
    expect(home.inHand.amount).toBe(820);
    expect(home.accounts.map((a: { name: string }) => a.name)).toEqual([
      "Everyday",
    ]);
  });
  it("lists the people you lend to, keeps them out of Clients, and keeps clients out of Loans", async () => {
    const person = (
      await write("/contacts", { name: "Pat", origin: "loan" })
    ).json() as Contact;
    expect(person.origin).toBe("loan");
    expect(client.origin).toBe("client");
    await move("lend", 300);
    const people = (await read("/loans")).json().items as {
      id: string;
      balances: { balance: { amount: number } }[];
    }[];
    expect(people.map((p) => p.id).sort()).toEqual(
      [client.id, person.id].sort(),
    );
    expect(
      people.find((p) => p.id === client.id)?.balances[0]?.balance.amount,
    ).toBe(300);
    expect(people.find((p) => p.id === person.id)?.balances).toEqual([]);
    // Clients show clients and people with services, not people added for loans.
    const ids = async () =>
      ((await read("/contacts?kind=clients")).json().items as Contact[]).map(
        (c) => c.id,
      );
    expect(await ids()).toEqual([client.id]);
    expect(((await read("/contacts")).json().items as Contact[]).length).toBe(
      2,
    );
    const service = await write("/receivables", {
      contactId: person.id,
      description: "Website work",
      serviceDate: "2026-10-07",
      dueDate: null,
      amount: money(5000),
    });
    expect(service.statusCode, service.body).toBe(201);
    expect((await ids()).sort()).toEqual([client.id, person.id].sort());
    // A plain client with no loan is not a loan person.
    const plain = (await write("/contacts", { name: "Lee" })).json() as Contact;
    expect(
      ((await read("/loans")).json().items as { id: string }[]).some(
        (p) => p.id === plain.id,
      ),
    ).toBe(false);
  });
  it("never lists another ledger's people", async () => {
    await write(
      "/contacts",
      { name: "Elsewhere", origin: "loan" },
      "POST",
      cookie,
      newId(),
      other,
    );
    expect(((await read("/loans")).json().items as unknown[]).length).toBe(0);
    const foreign = await app.inject({
      url: `${base(other)}/loans`,
      headers: { cookie: editor },
    });
    expect(foreign.statusCode).toBe(404);
    const mine = await app.inject({
      url: `${base(other)}/loans`,
      headers: { cookie },
    });
    expect(
      (mine.json().items as { name: string }[]).map((p) => p.name),
    ).toEqual(["Elsewhere"]);
  });
  it("replays a retried write without moving money twice", async () => {
    const key = newId();
    const first = await write(
      `/contacts/${client.id}/loans/lend`,
      { accountId, amount: money(300), date: "2026-10-07" },
      "POST",
      cookie,
      key,
    );
    const again = await write(
      `/contacts/${client.id}/loans/lend`,
      { accountId, amount: money(300), date: "2026-10-07" },
      "POST",
      cookie,
      key,
    );
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.headers["idempotency-replayed"]).toBe("true");
    expect(await owed()).toBe(300);
    expect(await balance()).toBe(700);
  });
  it("keeps a client's balance account out of hand edits and the client from deletion", async () => {
    await move("lend", 300);
    const loan = (await loans())[0];
    const id = loan?.accountId;
    expect(
      (
        await write(
          `/accounts/${id}`,
          { expectedVersion: loan?.version, name: "Mine" },
          "PATCH",
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await write(`/accounts/${id}/archive`, {
          expectedVersion: loan?.version,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await write(
          `/accounts/${id}`,
          { expectedVersion: loan?.version },
          "DELETE",
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await write(
          `/contacts/${client.id}`,
          { expectedVersion: client.version },
          "DELETE",
        )
      ).statusCode,
    ).toBe(409);
    // The balance account is not one of your own, and follows a client's new name.
    expect((await move("lend", 1, { accountId: id })).statusCode).toBe(409);
    const renamed = await write(
      `/contacts/${client.id}`,
      {
        name: "Samira",
        phone: client.phone,
        email: client.email,
        note: client.note,
        expectedVersion: client.version,
      },
      "PATCH",
    );
    expect(renamed.statusCode, renamed.body).toBe(200);
    const account = (await read(`/accounts/${id}`)).json();
    expect(account).toMatchObject({ name: "Samira", contactId: client.id });
  });
  it("refuses an archived client, another currency and a read-only role", async () => {
    expect(
      (
        await write(`/contacts/${client.id}/archive`, {
          expectedVersion: client.version,
        })
      ).statusCode,
    ).toBe(200);
    expect((await move("lend", 100)).statusCode).toBe(409);
    await write(`/contacts/${client.id}/unarchive`, {
      expectedVersion: client.version + 1,
    });
    const wrongCurrency = await write(`/contacts/${client.id}/loans/lend`, {
      accountId,
      amount: { amount: 100, currency: "EUR" },
      date: "2026-10-07",
    });
    expect(wrongCurrency.statusCode).toBe(409);
    expect((await move("lend", 0)).statusCode).toBe(400);
    expect((await move("lend", 100, {}, client)).statusCode).toBe(201);
    await db
      .update(ledgerMembers)
      .set({ role: "viewer" })
      .where(
        and(
          eq(ledgerMembers.ledgerId, ledgerId),
          eq(ledgerMembers.userId, users[0] as string),
        ),
      );
    expect((await move("lend", 100)).statusCode).toBe(403);
    expect((await read(`/contacts/${client.id}/loans`)).statusCode).toBe(200);
  });
  it("never crosses ledgers or lets the anonymous in", async () => {
    const foreignClient = (
      await write(
        "/contacts",
        { name: "Elsewhere" },
        "POST",
        cookie,
        newId(),
        other,
      )
    ).json() as Contact;
    const foreignAccount = newId();
    await db.insert(accounts).values({
      id: foreignAccount,
      ledgerId: other,
      name: "Other bank",
      type: "bank",
      openingBalance: 1000,
    });
    // Another ledger's client is not found here, in either direction.
    expect((await move("lend", 100, {}, foreignClient)).statusCode).toBe(404);
    expect((await read(`/contacts/${foreignClient.id}/loans`)).statusCode).toBe(
      404,
    );
    // Another ledger's account cannot be used for this ledger's client.
    expect(
      (await move("lend", 100, { accountId: foreignAccount })).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          url: `${base()}/contacts/${client.id}/loans`,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await write(
          `/contacts/${client.id}/loans/lend`,
          { accountId, amount: money(1), date: "2026-10-07" },
          "POST",
          "",
        )
      ).statusCode,
    ).toBe(401);
    expect(await loans()).toHaveLength(0);
    // Nothing was left behind in the other ledger by those attempts.
    expect(
      await db.select().from(accounts).where(eq(accounts.ledgerId, other)),
    ).toHaveLength(1);
  });
});
