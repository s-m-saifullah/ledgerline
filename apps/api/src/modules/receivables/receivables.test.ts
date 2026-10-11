import {
  type Contact,
  newId,
  type Receivable,
  type ReceivablePayment,
} from "@ledgerline/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
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
  receivablePayments,
  receivables,
  session,
  transactions,
  user,
  writeReceipts,
} from "../../db/schema";
import { hashPassword } from "../auth/password";
import { postedCategoryTotals } from "../transactions/balance-service";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("/ledgerline_test"))
  throw new Error("Receivables tests require dedicated ledgerline_test.");
const config = readConfig({
  NODE_ENV: "test",
  DATABASE_URL: url,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "receivables-test-secret-only-0000000000000000",
  OWNER_EMAIL: "receivables@example.com",
  OWNER_PASSWORD: "Receivables-test-password-000",
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
  viewer = "",
  accountId = "",
  categoryId = "",
  person: Contact;
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
async function service(amount = 10000): Promise<Receivable> {
  const r = await write("/receivables", {
    contactId: person.id,
    description: "Website work",
    serviceDate: "2026-10-07",
    dueDate: "2026-10-20",
    amount: money(amount),
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json();
}
function paymentBody(s: Receivable, amount = 4000) {
  return {
    amount: money(amount),
    accountId,
    categoryId,
    date: "2026-10-07",
    time: "14:32",
    note: "Received",
    expectedReceivableVersion: s.version,
  };
}
async function pay(s: Receivable, amount = 4000): Promise<ReceivablePayment> {
  const r = await write(
    `/receivables/${s.id}/payments`,
    paymentBody(s, amount),
  );
  expect(r.statusCode, r.body).toBe(201);
  return r.json();
}
const path = (p: ReceivablePayment) =>
  `/receivables/${p.receivableId}/payments/${p.id}`;
const versions = (p: ReceivablePayment) => ({
  expectedVersion: p.version,
  expectedReceivableVersion: p.receivable.version,
});
async function balance() {
  return (await read(`/accounts/${accountId}`)).json().balance.amount as number;
}
async function clear() {
  await db.transaction(async (tx) => {
    await tx
      .delete(receivableEvents)
      .where(inArray(receivableEvents.ledgerId, ids));
    await tx
      .delete(receivablePayments)
      .where(inArray(receivablePayments.ledgerId, ids));
    await tx.delete(transactions).where(inArray(transactions.ledgerId, ids));
    await tx.delete(receivables).where(inArray(receivables.ledgerId, ids));
    await tx.delete(contacts).where(inArray(contacts.ledgerId, ids));
  });
  await db.delete(categories).where(inArray(categories.ledgerId, ids));
  await db.delete(accounts).where(inArray(accounts.ledgerId, ids));
  await db.delete(writeReceipts).where(inArray(writeReceipts.ledgerId, ids));
}
beforeAll(async () => {
  await applyMigrations(url);
  await db
    .insert(ledgers)
    .values(ids.map((id) => ({ id, name: "Synthetic owed suite" })));
  const password = await hashPassword(config.OWNER_PASSWORD);
  for (const [i, role] of (["owner", "editor", "viewer"] as const).entries()) {
    const id = users[i] as string,
      email = `owed-${role}-${id}@example.com`;
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
        email: `owed-${role}-${users[i]}@example.com`,
        password: config.OWNER_PASSWORD,
      },
    });
    expect(r.statusCode).toBe(200);
    const c = r.headers["set-cookie"];
    cookies.push(
      (Array.isArray(c) ? c : [c ?? ""]).map((v) => v.split(";")[0]).join("; "),
    );
  }
  [cookie, editor, viewer] = cookies as [string, string, string];
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
  categoryId = newId();
  await db.insert(accounts).values({
    id: accountId,
    ledgerId,
    name: "Receiving",
    type: "bank",
    openingBalance: 1000,
  });
  await db
    .insert(categories)
    .values({ id: categoryId, ledgerId, name: "Services", kind: "income" });
  const r = await write("/contacts", {
    name: "Sam",
    phone: "+1 555 0100",
    email: "sam@example.com",
    note: "Synthetic",
  });
  expect(r.statusCode).toBe(201);
  person = r.json();
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
describe("Money owed scoped and atomic lifecycle", () => {
  it("unpaid services never post; partial/full receipts count income once", async () => {
    const s = await service();
    expect(await balance()).toBe(1000);
    expect(s.status).toBe("unpaid");
    let p = await pay(s);
    expect(p.receivable.outstanding.amount).toBe(6000);
    expect(await balance()).toBe(5000);
    p = await pay(p.receivable, 6000);
    expect(p.receivable.status).toBe("paid");
    expect(await balance()).toBe(11000);
    expect(
      (await read(`/contacts/${person.id}`)).json().openBalance.amount,
    ).toBe(0);
    expect(
      (
        await postedCategoryTotals(db, ledgerId, "2026-10-01", "2026-10-31")
      ).get(categoryId),
    ).toBe(10000n);
  });
  it("services keep an optional local time that survives omitted edits, clears on null and is validated", async () => {
    const plain = await service();
    expect(plain.serviceTime).toBeNull();
    const timed = await write("/receivables", {
      contactId: person.id,
      description: "Evening visit",
      serviceDate: "2026-10-07",
      serviceTime: "09:05",
      dueDate: null,
      amount: money(2500),
    });
    expect(timed.statusCode, timed.body).toBe(201);
    let row: Receivable = timed.json();
    expect(row.serviceTime).toBe("09:05");
    for (const bad of ["24:00", "9:5", "12:60", "noon"]) {
      const r = await write("/receivables", {
        contactId: person.id,
        description: "Bad time",
        serviceDate: "2026-10-07",
        serviceTime: bad,
        amount: money(100),
      });
      expect(r.statusCode, bad).toBe(400);
    }
    const edit = (extra: Record<string, unknown>) =>
      write(
        `/receivables/${row.id}`,
        {
          contactId: person.id,
          description: row.description,
          serviceDate: row.serviceDate,
          dueDate: row.dueDate,
          amount: row.amount,
          expectedVersion: row.version,
          ...extra,
        },
        "PATCH",
      );
    let r = await edit({ description: "Renamed" });
    expect(r.statusCode, r.body).toBe(200);
    row = r.json();
    expect(row.serviceTime).toBe("09:05");
    r = await edit({ serviceTime: "18:30" });
    row = r.json();
    expect(row.serviceTime).toBe("18:30");
    r = await edit({ serviceTime: null });
    row = r.json();
    expect(row.serviceTime).toBeNull();
    const events = await db
      .select()
      .from(receivableEvents)
      .where(eq(receivableEvents.receivableId, row.id));
    const times = events
      .map(
        (e) =>
          (e.after as { service: { serviceTime: string | null } }).service
            .serviceTime,
      )
      .sort();
    expect(times).toEqual([null, "09:05", "09:05", "18:30"].sort());
    await expect(
      pool.query("update receivables set service_time='25:00' where id=$1", [
        row.id,
      ]),
    ).rejects.toThrow(/receivables_time_check/);
  });
  it("receives payments only into USD accounts while money owed is USD-only", async () => {
    const service1 = await service();
    const euroAccount = newId();
    await db.insert(accounts).values({
      id: euroAccount,
      ledgerId,
      name: "Euro receiving",
      type: "bank",
      currency: "EUR",
      openingBalance: 0,
    });
    const refused = await write(`/receivables/${service1.id}/payments`, {
      ...paymentBody(service1, 4000),
      accountId: euroAccount,
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().errors[0].field).toBe("accountId");
    // Nothing was recorded, and a USD account still works.
    expect((await pay(service1, 4000)).amount.amount).toBe(4000);
  });
  it("edits stable linked identities, exact local time, amount and receiving account", async () => {
    const p = await pay(await service());
    const otherAccount = newId();
    await db.insert(accounts).values({
      id: otherAccount,
      ledgerId,
      name: "Other",
      type: "cash",
      openingBalance: 0,
    });
    const r = await write(
      path(p),
      {
        ...paymentBody(p.receivable, 3000),
        accountId: otherAccount,
        time: null,
        note: "Correction",
        expectedVersion: p.version,
      },
      "PATCH",
    );
    expect(r.statusCode, r.body).toBe(200);
    const q = r.json();
    expect(q.id).toBe(p.id);
    expect(q.transaction.id).toBe(p.transaction.id);
    expect(q.version).toBe(q.transaction.version);
    expect(q.receivable.outstanding.amount).toBe(7000);
    expect(q.transaction.time).toBeNull();
    expect(await balance()).toBe(1000);
    expect(
      (await read(`/accounts/${otherAccount}`)).json().balance.amount,
    ).toBe(3000);
  });
  it("paired delete and Undo restore original rows and replay 204", async () => {
    const p = await pay(await service()),
      key = newId();
    const r = await write(path(p), versions(p), "DELETE", cookie, key);
    expect(r.statusCode).toBe(204);
    expect(await balance()).toBe(1000);
    expect(
      (await write(path(p), versions(p), "DELETE", cookie, key)).statusCode,
    ).toBe(204);
    const q = await write(`${path(p)}/restore`, {
      expectedVersion: p.version + 1,
      expectedReceivableVersion: p.receivable.version + 1,
    });
    expect(q.statusCode, q.body).toBe(200);
    expect(q.json().transaction.id).toBe(p.transaction.id);
    expect(q.json().version).toBe(3);
    expect(await balance()).toBe(5000);
  });
  it("write-off waives only remainder and reopening supports versioned Undo", async () => {
    const p = await pay(await service());
    const r = await write(`/receivables/${p.receivableId}/write-off`, {
      expectedVersion: p.receivable.version,
      reason: "Uncollectible",
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().writtenOffAmount.amount).toBe(6000);
    expect(r.json().outstanding.amount).toBe(0);
    expect(await balance()).toBe(5000);
    expect(
      (
        await write(
          path(p),
          { ...versions(p), expectedReceivableVersion: r.json().version },
          "DELETE",
        )
      ).statusCode,
    ).toBe(409);
    const reopened = await write(`/receivables/${p.receivableId}/reopen`, {
      expectedVersion: r.json().version,
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().outstanding.amount).toBe(6000);
    const h = (await read(`/contacts/${person.id}/history`)).json().items;
    expect(h.map((e: { action: string }) => e.action)).toEqual([
      "reopened",
      "writtenOff",
      "paymentCreated",
      "created",
    ]);
    expect(h[1].after.service.writeOffReason).toBe("Uncollectible");
  });
  it("rejects overpayments, pending, split and foreign references", async () => {
    const s = await service();
    expect(
      (await write(`/receivables/${s.id}/payments`, paymentBody(s, 10001)))
        .statusCode,
    ).toBe(409);
    for (const extra of [
      { status: "pending" },
      { splits: [] },
      { transactionId: newId() },
    ])
      expect(
        (
          await write(`/receivables/${s.id}/payments`, {
            ...paymentBody(s),
            ...extra,
          })
        ).statusCode,
      ).toBe(400);
    expect(
      (
        await write(`/receivables/${s.id}/payments`, {
          ...paymentBody(s),
          accountId: newId(),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await write(`/receivables/${s.id}/payments`, {
          ...paymentBody(s),
          categoryId: newId(),
        })
      ).statusCode,
    ).toBe(404);
    expect(await balance()).toBe(1000);
  });
  it("concurrent payments and stale service edits cannot overpay or overwrite", async () => {
    const s = await service();
    const results = await Promise.all([
      write(`/receivables/${s.id}/payments`, paymentBody(s, 7000)),
      write(`/receivables/${s.id}/payments`, paymentBody(s, 7000)),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await balance()).toBe(8000);
    expect(
      (
        await write(
          `/receivables/${s.id}`,
          {
            contactId: person.id,
            description: "Stale",
            serviceDate: s.serviceDate,
            dueDate: null,
            amount: s.amount,
            expectedVersion: s.version,
          },
          "PATCH",
        )
      ).statusCode,
    ).toBe(409);
  });
  it("same intent replays after subsequent corrections without duplication; changed payload conflicts", async () => {
    const s = await service(),
      key = newId(),
      input = paymentBody(s);
    const [a, b] = await Promise.all([
      write(`/receivables/${s.id}/payments`, input, "POST", cookie, key),
      write(`/receivables/${s.id}/payments`, input, "POST", cookie, key),
    ]);
    expect(a.statusCode).toBe(201);
    expect(b.json()).toEqual(a.json());
    const p = a.json() as ReceivablePayment;
    await write(
      path(p),
      { ...paymentBody(p.receivable, 2000), expectedVersion: p.version },
      "PATCH",
    );
    const replay = await write(
      `/receivables/${s.id}/payments`,
      input,
      "POST",
      cookie,
      key,
    );
    expect(replay.json()).toEqual(p);
    expect(await balance()).toBe(3000);
    expect(
      (
        await write(
          `/receivables/${s.id}/payments`,
          { ...input, amount: money(1) },
          "POST",
          cookie,
          key,
        )
      ).statusCode,
    ).toBe(409);
  });
  it("ordinary endpoints cannot mutate active or tombstoned linked income", async () => {
    const p = await pay(await service());
    for (const [method, suffix, body] of [
      ["PATCH", "", { expectedVersion: 1, note: "Bad" }],
      ["DELETE", "", { expectedVersion: 1 }],
      ["POST", "/restore", { expectedVersion: 1 }],
    ] as const)
      expect(
        (await write(`/transactions/${p.transactionId}${suffix}`, body, method))
          .statusCode,
      ).toBe(409);
    await write(path(p), versions(p), "DELETE");
    expect(
      (
        await write(`/transactions/${p.transactionId}/restore`, {
          expectedVersion: 2,
        })
      ).statusCode,
    ).toBe(409);
  });
  it("retains archive references for correction/Undo but rejects new archive assignments", async () => {
    const p = await pay(await service());
    await write(`/accounts/${accountId}/archive`, { expectedVersion: 1 });
    await write(`/categories/${categoryId}/archive`, { expectedVersion: 1 });
    await write(`/contacts/${person.id}/archive`, { expectedVersion: 1 });
    const r = await write(
      path(p),
      { ...paymentBody(p.receivable, 3000), expectedVersion: p.version },
      "PATCH",
    );
    expect(r.statusCode, r.body).toBe(200);
    const q = r.json() as ReceivablePayment;
    await write(path(q), versions(q), "DELETE");
    expect(
      (
        await write(`${path(q)}/restore`, {
          expectedVersion: q.version + 1,
          expectedReceivableVersion: q.receivable.version + 1,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await write("/receivables", {
          contactId: person.id,
          description: "New",
          serviceDate: "2026-10-07",
          amount: money(1),
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await read(`/contacts/${person.id}`)).json().openBalance.amount,
    ).toBe(7000);
  });
  it("live payment blocks reference deletion; deleted references block paired Undo atomically", async () => {
    const p = await pay(await service());
    for (const resource of [
      `/accounts/${accountId}`,
      `/categories/${categoryId}`,
    ])
      expect(
        (await write(resource, { expectedVersion: 1 }, "DELETE")).statusCode,
      ).toBe(409);
    await write(path(p), versions(p), "DELETE");
    expect(
      (
        await write(
          `/categories/${categoryId}`,
          { expectedVersion: 1 },
          "DELETE",
        )
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await write(`${path(p)}/restore`, {
          expectedVersion: 2,
          expectedReceivableVersion: 3,
        })
      ).statusCode,
    ).toBe(404);
    expect(await balance()).toBe(1000);
    expect(
      (await read(`/receivables/${p.receivableId}`)).json().received.amount,
    ).toBe(0);
  });
  it("service deletion never cascades; Undo restores only service; contact deletion guards all live services", async () => {
    const p = await pay(await service());
    expect(
      (await write(`/contacts/${person.id}`, { expectedVersion: 1 }, "DELETE"))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await write(
          `/receivables/${p.receivableId}`,
          { expectedVersion: 2 },
          "DELETE",
        )
      ).statusCode,
    ).toBe(409);
    await write(path(p), versions(p), "DELETE");
    expect(
      (
        await write(
          `/receivables/${p.receivableId}`,
          { expectedVersion: 3 },
          "DELETE",
        )
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await write(`${path(p)}/restore`, {
          expectedVersion: 2,
          expectedReceivableVersion: 4,
        })
      ).statusCode,
    ).toBe(404);
    const r = await write(`/receivables/${p.receivableId}/restore`, {
      expectedVersion: 4,
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().received.amount).toBe(0);
    expect(await balance()).toBe(1000);
  });
  it("service Undo fails after person deletion", async () => {
    const s = await service();
    await write(`/receivables/${s.id}`, { expectedVersion: 1 }, "DELETE");
    expect(
      (await write(`/contacts/${person.id}`, { expectedVersion: 1 }, "DELETE"))
        .statusCode,
    ).toBe(204);
    expect(
      (await write(`/receivables/${s.id}/restore`, { expectedVersion: 2 }))
        .statusCode,
    ).toBe(404);
  });
  it("amount lower bound and fixed person after any payment history", async () => {
    const p = await pay(await service());
    const body = {
      contactId: person.id,
      description: "Corrected",
      serviceDate: "2026-09-30",
      dueDate: null,
      amount: money(3999),
      expectedVersion: 2,
    };
    expect(
      (await write(`/receivables/${p.receivableId}`, body, "PATCH")).statusCode,
    ).toBe(409);
    const otherPerson = (await write("/contacts", { name: "Alex" })).json();
    await write(path(p), versions(p), "DELETE");
    expect(
      (
        await write(
          `/receivables/${p.receivableId}`,
          {
            ...body,
            contactId: otherPerson.id,
            amount: money(10000),
            expectedVersion: 3,
          },
          "PATCH",
        )
      ).statusCode,
    ).toBe(409);
  });
  it("exact maximum service cents and aggregate overflow roll back receipt and service", async () => {
    const s = await service(Number.MAX_SAFE_INTEGER);
    expect(s.amount.amount).toBe(Number.MAX_SAFE_INTEGER);
    const key = newId();
    const r = await write(
      "/receivables",
      {
        contactId: person.id,
        description: "Overflow",
        serviceDate: "2026-10-07",
        amount: money(1),
      },
      "POST",
      cookie,
      key,
    );
    expect(r.statusCode).toBe(409);
    expect(
      (
        await db
          .select()
          .from(writeReceipts)
          .where(
            and(
              eq(writeReceipts.ledgerId, ledgerId),
              eq(writeReceipts.key, key),
            ),
          )
      ).length,
    ).toBe(0);
    expect((await read("/receivables")).json().items).toHaveLength(1);
  });
  it("posted overflow rolls back linked writes and history; same key can retry after correction", async () => {
    const s = await service(1),
      key = newId();
    await db
      .update(accounts)
      .set({ openingBalance: Number.MAX_SAFE_INTEGER })
      .where(eq(accounts.id, accountId));
    const input = paymentBody(s, 1);
    expect(
      (await write(`/receivables/${s.id}/payments`, input, "POST", cookie, key))
        .statusCode,
    ).toBe(409);
    expect(
      (await read(`/contacts/${person.id}/history`)).json().items,
    ).toHaveLength(1);
    expect(
      (await read(`/receivables/${s.id}/payments`)).json().items,
    ).toHaveLength(0);
    await db
      .update(accounts)
      .set({ openingBalance: 0 })
      .where(eq(accounts.id, accountId));
    expect(
      (await write(`/receivables/${s.id}/payments`, input, "POST", cookie, key))
        .statusCode,
    ).toBe(201);
  });
  it("database rejects independent amount, unlink, pending, parent and pair changes", async () => {
    const p = await pay(await service());
    for (const query of [
      sql`update transactions set amount=amount+1,base_amount=base_amount+1 where id=${p.transactionId}`,
      sql`update transactions set receivable_payment_id=null,receivable_id=null where id=${p.transactionId}`,
      sql`update transactions set status='pending' where id=${p.transactionId}`,
      sql`update receivable_payments set deleted_at=now() where id=${p.id}`,
      sql`update receivables set amount=1 where id=${p.receivableId}`,
      sql`update receivables set deleted_at=now() where id=${p.receivableId}`,
    ])
      await expect(db.transaction((tx) => tx.execute(query))).rejects.toThrow();
    expect(await balance()).toBe(5000);
  });
  it("all read endpoints exclude another ledger and deny anonymous access", async () => {
    const p = await pay(await service());
    for (const endpoint of [
      "/contacts",
      `/contacts/${person.id}`,
      `/contacts/${person.id}/history`,
      "/receivables",
      `/receivables/${p.receivableId}`,
      `/receivables/${p.receivableId}/payments`,
      path(p),
    ]) {
      expect((await read(endpoint, "")).statusCode).toBe(401);
      expect((await read(endpoint, viewer)).statusCode).toBe(200);
      const r = await app.inject({
        url: base(other) + endpoint,
        headers: { cookie },
      });
      expect(r.statusCode).toBe(
        endpoint === "/contacts" || endpoint === "/receivables" ? 200 : 404,
      );
      if (r.statusCode === 200) expect(r.json().items).toEqual([]);
      expect(
        (
          await app.inject({
            url: base(foreign) + endpoint,
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(404);
    }
  });
  it("all mutations enforce ledger, viewer, Origin, key and versions", async () => {
    const s = await service(),
      p = await pay(s);
    const cases: [string, unknown, "POST" | "PATCH" | "DELETE"][] = [
      ["/contacts", { name: "X" }, "POST"],
      [
        `/contacts/${person.id}`,
        { name: "X", phone: null, email: null, note: null, expectedVersion: 1 },
        "PATCH",
      ],
      [`/contacts/${person.id}`, { expectedVersion: 1 }, "DELETE"],
      [`/contacts/${person.id}/archive`, { expectedVersion: 1 }, "POST"],
      [`/contacts/${person.id}/unarchive`, { expectedVersion: 1 }, "POST"],
      [
        "/receivables",
        {
          contactId: person.id,
          description: "X",
          serviceDate: s.serviceDate,
          amount: money(1),
        },
        "POST",
      ],
      [
        `/receivables/${s.id}`,
        {
          contactId: person.id,
          description: "X",
          serviceDate: s.serviceDate,
          dueDate: null,
          amount: s.amount,
          expectedVersion: 2,
        },
        "PATCH",
      ],
      ...(["delete", "restore", "write-off", "reopen"] as const).map(
        (a) =>
          [
            `/receivables/${s.id}${a === "delete" ? "" : `/${a}`}`,
            { expectedVersion: 2 },
            a === "delete" ? "DELETE" : "POST",
          ] as [string, unknown, "POST" | "DELETE"],
      ),
      [`/receivables/${s.id}/payments`, paymentBody(p.receivable, 1), "POST"],
      [path(p), { ...paymentBody(p.receivable), expectedVersion: 1 }, "PATCH"],
      [path(p), versions(p), "DELETE"],
      [`${path(p)}/restore`, versions(p), "POST"],
    ];
    for (const [endpoint, body, method] of cases) {
      expect((await write(endpoint, body, method, "")).statusCode).toBe(401);
      expect((await write(endpoint, body, method, viewer)).statusCode).toBe(
        403,
      );
      expect(
        (await write(endpoint, body, method, cookie, newId(), foreign))
          .statusCode,
      ).toBe(404);
      if (endpoint !== "/contacts")
        expect(
          (await write(endpoint, body, method, cookie, newId(), other))
            .statusCode,
        ).toBe(404);
      expect(
        (
          await app.inject({
            url: base() + endpoint,
            method,
            headers: { ...headers(), origin: "https://wrong.example" },
            payload: JSON.stringify(body),
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            url: base() + endpoint,
            method,
            headers: { ...headers(), "idempotency-key": "bad" },
            payload: JSON.stringify(body),
          })
        ).statusCode,
      ).toBe(400);
    }
  });
  it("rechecks revoked role before replay and permits editor writes", async () => {
    const key = newId();
    expect(
      (await write("/contacts", { name: "Editor" }, "POST", editor, key))
        .statusCode,
    ).toBe(201);
    await db
      .update(ledgerMembers)
      .set({ role: "viewer" })
      .where(
        and(
          eq(ledgerMembers.ledgerId, ledgerId),
          eq(ledgerMembers.userId, users[1] as string),
        ),
      );
    expect(
      (await write("/contacts", { name: "Editor" }, "POST", editor, key))
        .statusCode,
    ).toBe(403);
    await db
      .update(ledgerMembers)
      .set({ role: "editor" })
      .where(
        and(
          eq(ledgerMembers.ledgerId, ledgerId),
          eq(ledgerMembers.userId, users[1] as string),
        ),
      );
  });
  it("pagination filters and balances include all service pages and archived people", async () => {
    for (let i = 0; i < 3; i++) await service(100 + i);
    const a = (await read("/receivables?limit=2")).json(),
      b = (await read(`/receivables?limit=2&cursor=${a.nextCursor}`)).json();
    expect(
      new Set([...a.items, ...b.items].map((s: Receivable) => s.id)).size,
    ).toBe(3);
    expect(
      (await read(`/contacts/${person.id}`)).json().openBalance.amount,
    ).toBe(303);
    expect(
      (
        await read("/receivables?text=Website&status=unpaid&from=2026-10-07")
      ).json().items,
    ).toHaveLength(3);
    await write(`/contacts/${person.id}/archive`, { expectedVersion: 1 });
    expect(
      (await read("/contacts?status=all")).json().items[0].openBalance.amount,
    ).toBe(303);
    expect((await read("/contacts?status=active")).json().items).toHaveLength(
      0,
    );
  });
  it("rolls back linked rows, parent version and event when receipt insertion fails", async () => {
    const s = await service(),
      key = newId(),
      suffix = ledgerId.replaceAll("-", "");
    await db.execute(
      sql.raw(
        `CREATE FUNCTION owed_failure_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.ledger_id='${ledgerId}'::uuid THEN RAISE EXCEPTION 'Injected receipt failure'; END IF; RETURN NEW; END $$`,
      ),
    );
    await db.execute(
      sql.raw(
        `CREATE TRIGGER owed_failure_${suffix} BEFORE INSERT ON write_receipts FOR EACH ROW EXECUTE FUNCTION owed_failure_${suffix}()`,
      ),
    );
    try {
      expect(
        (
          await write(
            `/receivables/${s.id}/payments`,
            paymentBody(s),
            "POST",
            cookie,
            key,
          )
        ).statusCode,
      ).toBe(500);
      expect(await balance()).toBe(1000);
      expect((await read(`/receivables/${s.id}`)).json().version).toBe(1);
      expect(
        (await read(`/contacts/${person.id}/history`)).json().items,
      ).toHaveLength(1);
    } finally {
      await db.execute(
        sql.raw(`DROP TRIGGER owed_failure_${suffix} ON write_receipts`),
      );
      await db.execute(sql.raw(`DROP FUNCTION owed_failure_${suffix}()`));
    }
    expect(
      (
        await write(
          `/receivables/${s.id}/payments`,
          paymentBody(s),
          "POST",
          cookie,
          key,
        )
      ).statusCode,
    ).toBe(201);
  });
  it("replays persisted payment receipt from a fresh API/database connection", async () => {
    const s = await service(),
      key = newId(),
      body = paymentBody(s),
      r = await write(
        `/receivables/${s.id}/payments`,
        body,
        "POST",
        cookie,
        key,
      ),
      fresh = createDatabase(url),
      restarted = await buildApp(fresh.db, config);
    try {
      await restarted.ready();
      const replay = await restarted.inject({
        method: "POST",
        url: `${base()}/receivables/${s.id}/payments`,
        headers: headers(cookie, key),
        payload: body,
      });
      expect(replay.statusCode).toBe(201);
      expect(replay.json()).toEqual(r.json());
      expect(await balance()).toBe(5000);
    } finally {
      await restarted.close();
      await fresh.pool.end();
    }
  });
  it("payment deletion rejects negative balance overflow without removing income", async () => {
    const p = await pay(await service(1), 1);
    await db
      .update(accounts)
      .set({ openingBalance: Number.MIN_SAFE_INTEGER })
      .where(eq(accounts.id, accountId));
    const expenseId = newId();
    await db
      .insert(categories)
      .values({ id: expenseId, ledgerId, name: "Expense", kind: "expense" });
    const r = await write("/transactions", {
      accountId,
      categoryId: expenseId,
      kind: "expense",
      date: "2026-10-07",
      amount: money(-1),
    });
    expect(r.statusCode).toBe(201);
    expect(await balance()).toBe(Number.MIN_SAFE_INTEGER);
    expect((await write(path(p), versions(p), "DELETE")).statusCode).toBe(409);
    expect((await read(path(p))).statusCode).toBe(200);
  });
  it("serializes person deletion against service assignment", async () => {
    const [a, b] = await Promise.all([
      write("/receivables", {
        contactId: person.id,
        description: "Concurrent work",
        serviceDate: "2026-10-07",
        amount: money(1),
      }),
      write(`/contacts/${person.id}`, { expectedVersion: 1 }, "DELETE"),
    ]);
    expect([a.statusCode, b.statusCode]).toSatisfy(
      (v: number[]) =>
        (v[0] === 201 && v[1] === 409) || (v[0] === 404 && v[1] === 204),
    );
  });
  it("rejects payment Undo after intervening collection or write-off", async () => {
    const p = await pay(await service());
    await write(path(p), versions(p), "DELETE");
    const latest = (
      await read(`/receivables/${p.receivableId}`)
    ).json() as Receivable;
    await pay(latest, 10000);
    expect(
      (
        await write(`${path(p)}/restore`, {
          expectedVersion: 2,
          expectedReceivableVersion: 3,
        })
      ).statusCode,
    ).toBe(409);
    expect(await balance()).toBe(11000);
  });
  it("retains maximum-length Unicode service and payment notes in correction history", async () => {
    const description = `${"\u0001".repeat(1998)}💵`,
      note = `${"\u0001".repeat(1998)}💵`;
    const response = await write("/receivables", {
      contactId: person.id,
      description,
      serviceDate: "2026-10-07",
      amount: money(10000),
    });
    expect(response.statusCode, response.body).toBe(201);
    const s = response.json() as Receivable;
    const created = await write(`/receivables/${s.id}/payments`, {
      ...paymentBody(s),
      note,
    });
    expect(created.statusCode, created.body).toBe(201);
    const p = created.json() as ReceivablePayment;
    const corrected = await write(
      path(p),
      { ...paymentBody(p.receivable, 3000), ...versions(p), note },
      "PATCH",
    );
    expect(corrected.statusCode, corrected.body).toBe(200);
    const history = (await read(`/contacts/${person.id}/history`)).json();
    expect(history.items[0].before.payment.note).toBe(note);
    expect(history.items[0].after.service.description).toBe(description);
  });
  it("documents all People endpoints with versioned public security contracts", async () => {
    const doc = (
      await app.inject({ url: "/api/v1/openapi.json", headers: { cookie } })
    ).json();
    expect(doc.info.version).toBe("0.1.23");
    const prefix = "/api/v1/ledgers/{ledgerId}";
    for (const resource of [
      "/contacts",
      "/receivables",
      "/receivables/{receivableId}/payments",
    ]) {
      const item = doc.paths[prefix + resource];
      expect(item.get.security).toEqual([{ sessionCookie: [] }]);
      expect(
        item.post.parameters.some(
          (p: { name: string; required: boolean }) =>
            p.name === "idempotency-key" && p.required,
        ),
      ).toBe(true);
      expect(item.post.responses["409"]).toBeDefined();
    }
  });
});
