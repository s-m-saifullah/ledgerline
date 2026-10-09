import {
  type Contact,
  newId,
  type Receipt,
  type Receivable,
  type ReceivablePayment,
} from "@ledgerline/shared";
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
  receivablePayments,
  receivables,
  session,
  transactions,
  user,
  writeReceipts,
} from "../../db/schema";
import { hashPassword } from "../auth/password";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("/ledgerline_test"))
  throw new Error("Receipts tests require dedicated ledgerline_test.");
const config = readConfig({
  NODE_ENV: "test",
  DATABASE_URL: url,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "receipts-test-secret-only-000000000000000000",
  OWNER_EMAIL: "receipts@example.com",
  OWNER_PASSWORD: "Receipts-test-password-0000",
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
    .values(ids.map((id) => ({ id, name: "Synthetic receipts suite" })));
  const password = await hashPassword(config.OWNER_PASSWORD);
  for (const [i, role] of (["owner", "editor", "viewer"] as const).entries()) {
    const id = users[i] as string,
      email = `receipt-${role}-${id}@example.com`;
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
        email: `receipt-${role}-${users[i]}@example.com`,
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
async function svc(date: string, amount: number, who = person) {
  const r = await write("/receivables", {
    contactId: who.id,
    description: `Work ${date}`,
    serviceDate: date,
    dueDate: null,
    amount: money(amount),
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as Receivable;
}
async function previewOf(amount: number, who = person, actor = cookie) {
  return app.inject({
    url: `${base()}/contacts/${who.id}/receipt-preview?amount=${amount}`,
    headers: { cookie: actor },
  });
}
function receiptBody(
  preview: {
    allocations: {
      receivableId: string;
      version: number;
      applied: { amount: number };
    }[];
  },
  amount: number,
  over: Record<string, unknown> = {},
) {
  return {
    amount: money(amount),
    accountId,
    categoryId,
    date: "2026-10-08",
    time: "10:15",
    note: "Bulk",
    expectedAllocations: preview.allocations.map((a) => ({
      receivableId: a.receivableId,
      expectedVersion: a.version,
      applied: a.applied.amount,
    })),
    ...over,
  };
}
async function payReceipt(amount: number, who = person, key = newId()) {
  const preview = (await previewOf(amount, who)).json();
  return write(
    `/contacts/${who.id}/receipts`,
    receiptBody(preview, amount),
    "POST",
    cookie,
    key,
  );
}
const incomeRows = () =>
  db
    .select()
    .from(transactions)
    .where(
      and(eq(transactions.ledgerId, ledgerId), eq(transactions.kind, "income")),
    );
const expectedPayments = (r: Receipt, bump = 0) =>
  r.payments.map((p) => ({
    paymentId: p.id,
    expectedVersion: p.version + bump,
    expectedReceivableVersion: p.receivable.version + bump,
  }));
const people = async () =>
  ((await read("/contacts")).json().items as Contact[]).find(
    (c) => c.id === person.id,
  ) as Contact;

describe("Person-level receipts", () => {
  it("previews oldest-service-first serial allocation with exact cents", async () => {
    await svc("2026-10-01", 30000);
    const a = await svc("2026-09-01", 20000);
    const b = await svc("2026-09-15", 20000);
    const preview = (await previewOf(50000)).json();
    expect(preview.openTotal).toEqual(money(70000));
    expect(preview.exceedsBalance).toBe(false);
    expect(
      preview.allocations.map(
        (x: {
          receivableId: string;
          applied: { amount: number };
          remainingAfter: { amount: number };
        }) => [x.receivableId, x.applied.amount, x.remainingAfter.amount],
      ),
    ).toEqual([
      [a.id, 20000, 0],
      [b.id, 20000, 0],
      [expect.any(String), 10000, 20000],
    ]);
    const over = (await previewOf(70001)).json();
    expect(over.exceedsBalance).toBe(true);
    expect(over.allocations).toEqual([]);
    expect((await previewOf(0)).statusCode).toBe(400);
  });

  it("breaks service-date ties by creation order", async () => {
    const first = await svc("2026-09-01", 1000);
    await svc("2026-09-01", 1000);
    const preview = (await previewOf(1500)).json();
    expect(preview.allocations[0].receivableId).toBe(first.id);
    expect(preview.allocations[0].applied.amount).toBe(1000);
    expect(preview.allocations[1].applied.amount).toBe(500);
  });

  it("creates linked payments and income across services atomically, counted once", async () => {
    const a = await svc("2026-09-01", 20000);
    await svc("2026-09-15", 20000);
    const c = await svc("2026-10-01", 30000);
    const before = await balance();
    const r = await payReceipt(50000);
    expect(r.statusCode, r.body).toBe(201);
    const receipt: Receipt = r.json();
    expect(receipt.amount).toEqual(money(50000));
    expect(receipt.payments).toHaveLength(3);
    expect(new Set(receipt.payments.map((p) => p.receiptId))).toEqual(
      new Set([receipt.id]),
    );
    expect(receipt.payments.map((p) => p.amount.amount)).toEqual([
      20000, 20000, 10000,
    ]);
    expect(await balance()).toBe(before + 50000);
    expect(await incomeRows()).toHaveLength(3);
    expect((await people()).openBalance).toEqual(money(20000));
    const status = async (id: string) =>
      (await read(`/receivables/${id}`)).json().status;
    expect(await status(a.id)).toBe("paid");
    expect(await status(c.id)).toBe("partlyPaid");
    const history = (await read(`/contacts/${person.id}/history`)).json().items;
    expect(
      history.filter((e: { action: string }) => e.action === "paymentCreated"),
    ).toHaveLength(3);
    const fetched = await read(`/receipts/${receipt.id}`);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().payments).toHaveLength(3);
  });

  it("skips paid, written-off and deleted services", async () => {
    const waived = await svc("2026-08-01", 5000);
    const gone = await svc("2026-08-02", 5000);
    const paid = await svc("2026-08-03", 5000);
    const open = await svc("2026-08-04", 9000);
    expect(
      (
        await write(`/receivables/${waived.id}/write-off`, {
          expectedVersion: waived.version,
          reason: null,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await write(
          `/receivables/${gone.id}`,
          { expectedVersion: gone.version },
          "DELETE",
        )
      ).statusCode,
    ).toBe(204);
    await pay(
      await (async () => (await read(`/receivables/${paid.id}`)).json())(),
      5000,
    );
    const preview = (await previewOf(9000)).json();
    expect(preview.allocations).toHaveLength(1);
    expect(preview.allocations[0].receivableId).toBe(open.id);
    expect(preview.openTotal).toEqual(money(9000));
  });

  it("rejects overpayment, stale previews and invalid references without partial writes", async () => {
    const a = await svc("2026-09-01", 2000);
    await svc("2026-09-02", 2000);
    const over = await write(
      `/contacts/${person.id}/receipts`,
      receiptBody({ allocations: [] }, 4001, {
        expectedAllocations: [
          { receivableId: a.id, expectedVersion: a.version, applied: 1 },
        ],
      }),
    );
    expect(over.statusCode).toBe(409);
    const preview = (await previewOf(3000)).json();
    // A competing single-service payment changes the first service's version.
    await pay(a, 500);
    const stale = await write(
      `/contacts/${person.id}/receipts`,
      receiptBody(preview, 3000),
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json().detail).toMatch(/Balances changed/);
    const badCategory = await write(
      `/contacts/${person.id}/receipts`,
      receiptBody((await previewOf(1000)).json(), 1000, {
        categoryId: newId(),
      }),
    );
    expect(badCategory.statusCode).toBeGreaterThanOrEqual(400);
    expect(await incomeRows()).toHaveLength(1);
    expect((await people()).openBalance).toEqual(money(3500));
  });

  it("replays one receipt for the same key and rejects a changed payload", async () => {
    await svc("2026-09-01", 2000);
    await svc("2026-09-02", 2000);
    const key = newId();
    const preview = (await previewOf(3000)).json();
    const body = receiptBody(preview, 3000);
    const first = await write(
      `/contacts/${person.id}/receipts`,
      body,
      "POST",
      cookie,
      key,
    );
    const again = await write(
      `/contacts/${person.id}/receipts`,
      body,
      "POST",
      cookie,
      key,
    );
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.json().id).toBe(first.json().id);
    expect(await incomeRows()).toHaveLength(2);
    const changed = await write(
      `/contacts/${person.id}/receipts`,
      { ...body, note: "different" },
      "POST",
      cookie,
      key,
    );
    expect(changed.statusCode).toBeGreaterThanOrEqual(400);
    expect(await incomeRows()).toHaveLength(2);
  });

  it("limits one receipt to 100 services", async () => {
    for (let i = 0; i < 101; i++) await svc("2026-07-01", 100);
    const preview = (await previewOf(10100)).json();
    expect(preview.tooManyServices).toBe(true);
    const r = await write(
      `/contacts/${person.id}/receipts`,
      receiptBody(preview, 10100),
    );
    // The contract itself caps expected allocations at 100 (validation error).
    expect(r.statusCode).toBe(400);
    expect(await incomeRows()).toHaveLength(0);
    const ok = await payReceipt(10000);
    expect(ok.statusCode).toBe(201);
  });

  it("blocks changing member payments individually", async () => {
    await svc("2026-09-01", 2000);
    await svc("2026-09-02", 2000);
    const receipt: Receipt = (await payReceipt(3000)).json();
    const [p] = receipt.payments;
    if (!p) throw new Error("missing payment");
    const path = `/receivables/${p.receivableId}/payments/${p.id}`;
    const common = {
      expectedVersion: p.version,
      expectedReceivableVersion: p.receivable.version,
    };
    expect(
      (
        await write(
          path,
          { ...paymentBody(p.receivable, 100), ...common },
          "PATCH",
        )
      ).statusCode,
    ).toBe(409);
    expect((await write(path, common, "DELETE")).statusCode).toBe(409);
    expect(await incomeRows()).toHaveLength(2);
  });

  it("deletes and restores a whole receipt together with exact balances", async () => {
    await svc("2026-09-01", 2000);
    await svc("2026-09-02", 2000);
    const before = await balance();
    const receipt: Receipt = (await payReceipt(3000)).json();
    expect(await balance()).toBe(before + 3000);
    const stale = await write(
      `/receipts/${receipt.id}`,
      { expectedPayments: expectedPayments(receipt, 5) },
      "DELETE",
    );
    expect(stale.statusCode).toBe(409);
    expect(await balance()).toBe(before + 3000);
    const del = await write(
      `/receipts/${receipt.id}`,
      { expectedPayments: expectedPayments(receipt) },
      "DELETE",
    );
    expect(del.statusCode).toBe(204);
    expect(await balance()).toBe(before);
    expect((await people()).openBalance).toEqual(money(4000));
    expect((await read(`/receipts/${receipt.id}`)).statusCode).toBe(404);
    const missingOne = await write(`/receipts/${receipt.id}/restore`, {
      expectedPayments: expectedPayments(receipt, 1).slice(1),
    });
    expect(missingOne.statusCode).toBe(409);
    const back = await write(`/receipts/${receipt.id}/restore`, {
      expectedPayments: expectedPayments(receipt, 1),
    });
    expect(back.statusCode, back.body).toBe(200);
    expect(back.json().payments.map((x: ReceivablePayment) => x.id)).toEqual(
      receipt.payments.map((x) => x.id),
    );
    expect(await balance()).toBe(before + 3000);
    expect((await people()).openBalance).toEqual(money(1000));
  });

  it("corrects receipt details for every payment but never amounts", async () => {
    await svc("2026-09-01", 2000);
    await svc("2026-09-02", 2000);
    const receipt: Receipt = (await payReceipt(3000)).json();
    const other = newId();
    await db.insert(accounts).values({
      id: other,
      ledgerId,
      name: "Cash",
      type: "cash",
      openingBalance: 0,
    });
    const r = await write(
      `/receipts/${receipt.id}`,
      {
        accountId: other,
        categoryId,
        date: "2026-10-07",
        time: null,
        note: "Fixed",
        expectedPayments: expectedPayments(receipt),
      },
      "PATCH",
    );
    expect(r.statusCode, r.body).toBe(200);
    const rows = await incomeRows();
    expect(
      rows.every(
        (t) =>
          t.accountId === other &&
          t.date === "2026-10-07" &&
          t.note === "Fixed" &&
          t.time === null,
      ),
    ).toBe(true);
    expect(rows.map((t) => t.amount).sort()).toEqual([1000, 2000]);
    const stale = await write(
      `/receipts/${receipt.id}`,
      {
        accountId: other,
        categoryId,
        date: "2026-10-07",
        time: null,
        note: "x",
        expectedPayments: expectedPayments(receipt),
      },
      "PATCH",
    );
    expect(stale.statusCode).toBe(409);
  });

  it("enforces roles, validation and ledger isolation", async () => {
    await svc("2026-09-01", 2000);
    const preview = (await previewOf(1000)).json();
    expect(
      (
        await write(
          `/contacts/${person.id}/receipts`,
          receiptBody(preview, 1000),
          "POST",
          viewer,
        )
      ).statusCode,
    ).toBe(403);
    expect((await previewOf(1000, person, viewer)).statusCode).toBe(200);
    expect(
      (
        await write(
          `/contacts/${person.id}/receipts`,
          receiptBody(preview, 1000),
          "POST",
          editor,
        )
      ).statusCode,
    ).toBe(201);
    const receipt: Receipt = (await payReceipt(500)).json();
    expect(
      (
        await app.inject({
          url: `${base(other)}/receipts/${receipt.id}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          url: `${base(foreign)}/receipts/${receipt.id}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          url: `${base(other)}/contacts/${person.id}/receipt-preview?amount=100`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await write(
          `/receipts/${receipt.id}`,
          { expectedPayments: expectedPayments(receipt) },
          "DELETE",
          viewer,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: `${base()}/receipts/${receipt.id}` }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await write(`/contacts/${person.id}/receipts`, {
          ...receiptBody(preview, 1000),
          amount: money(-1),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await write(`/contacts/${person.id}/receipts`, {
          ...receiptBody(preview, 1000),
          expectedAllocations: [],
        })
      ).statusCode,
    ).toBe(400);
  });

  it("documents receipt endpoints in OpenAPI", async () => {
    const doc = (await app.inject({ url: "/api/v1/openapi.json" })).json();
    expect(
      doc.paths["/api/v1/ledgers/{ledgerId}/receipts/{receiptId}"],
    ).toBeTruthy();
    expect(
      doc.paths["/api/v1/ledgers/{ledgerId}/contacts/{contactId}/receipts"]
        .post,
    ).toBeTruthy();
  });
});
