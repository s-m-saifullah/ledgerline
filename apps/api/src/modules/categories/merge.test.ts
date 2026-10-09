import {
  type Category,
  type CategoryMergePreview,
  eventSnapshotSchema,
  newId,
  type Transaction,
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
  transactionSplits,
  transactions,
  user,
  writeReceipts,
} from "../../db/schema";
import { hashPassword } from "../auth/password";
import { postedCategoryTotals } from "../transactions/balance-service";
import { mergeCategories } from "./merge-service";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("/ledgerline_test"))
  throw new Error("Merge tests require dedicated ledgerline_test.");
const config = readConfig({
  NODE_ENV: "test",
  DATABASE_URL: url,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "merge-test-secret-only-00000000000000000000",
  OWNER_EMAIL: "merge@example.com",
  OWNER_PASSWORD: "Merge-test-password-000",
});
const { db, pool } = createDatabase(url),
  app = await buildApp(db, config);
const ledgerId = newId(),
  other = newId(),
  foreign = newId(),
  ids = [ledgerId, other, foreign],
  users = [newId(), newId(), newId()];
let owner = "",
  editor = "",
  viewer = "",
  accountId = "",
  source: Category,
  destination: Category;
const money = (amount: number) => ({ amount, currency: "USD" });
const base = (ledger = ledgerId) => `/api/v1/ledgers/${ledger}`;
const headers = (cookie = owner, key = newId()) => ({
  cookie,
  origin: config.APP_URL,
  "idempotency-key": key,
  "content-type": "application/json",
});
const write = (
  path: string,
  payload: unknown,
  method: "POST" | "PATCH" | "DELETE" = "POST",
  cookie = owner,
  key = newId(),
  ledger = ledgerId,
) =>
  app.inject({
    method,
    url: base(ledger) + path,
    headers: headers(cookie, key),
    payload: JSON.stringify(payload),
  });
const read = (path: string, cookie = owner, ledger = ledgerId) =>
  app.inject({ url: base(ledger) + path, headers: { cookie } });
async function saved<T>(path: string, payload: unknown): Promise<T> {
  const r = await write(path, payload);
  expect(r.statusCode, r.body).toBe(201);
  return r.json();
}
const category = (
  name: string,
  kind = "expense",
  parentId: string | null = null,
) => saved<Category>("/categories", { name, kind, parentId });
const transaction = (
  categoryId = source.id,
  amount = -125,
  status = "cleared",
) =>
  saved<Transaction>("/transactions", {
    accountId,
    categoryId,
    kind: amount < 0 ? "expense" : "income",
    amount: money(amount),
    date: "2026-10-07",
    time: "14:32",
    status,
    payee: "Synthetic",
    note: "Keep this note",
  });
async function preview(
  s = source.id,
  d = destination.id,
  cookie = owner,
): Promise<CategoryMergePreview> {
  const r = await read(
    `/categories/${s}/merge-preview?destinationCategoryId=${d}`,
    cookie,
  );
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
const body = (p: CategoryMergePreview) => ({
  destinationCategoryId: p.destination.id,
  expectedSourceVersion: p.expectedSourceVersion,
  expectedDestinationVersion: p.expectedDestinationVersion,
  previewToken: p.previewToken,
});
const merge = (p: CategoryMergePreview, cookie = owner, key = newId()) =>
  write(`/categories/${p.source.id}/merge`, body(p), "POST", cookie, key);
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
    await tx
      .delete(transactionSplits)
      .where(inArray(transactionSplits.ledgerId, ids));
    await tx.delete(transactions).where(inArray(transactions.ledgerId, ids));
    await tx.delete(receivables).where(inArray(receivables.ledgerId, ids));
    await tx.delete(contacts).where(inArray(contacts.ledgerId, ids));
    await tx.delete(categories).where(inArray(categories.ledgerId, ids));
    await tx.delete(accounts).where(inArray(accounts.ledgerId, ids));
    await tx.delete(writeReceipts).where(inArray(writeReceipts.ledgerId, ids));
  });
}
async function snapshot() {
  const result: unknown[] = [];
  for (const table of [
    "accounts",
    "categories",
    "transactions",
    "transaction_splits",
    "contacts",
    "receivables",
    "receivable_payments",
    "receivable_events",
    "write_receipts",
  ])
    result.push(
      (
        await pool.query(
          `SELECT row_to_json(t) FROM ${table} t WHERE ledger_id=$1 ORDER BY id`,
          [ledgerId],
        )
      ).rows,
    );
  return result;
}
async function linked(categoryId: string, amounts = [1000, 2000]) {
  const person = await saved<{ id: string }>("/contacts", {
    name: "Synthetic person",
  });
  let service = await saved<{ id: string; version: number }>("/receivables", {
    contactId: person.id,
    description: "Synthetic service",
    amount: money(10000),
    serviceDate: "2026-10-07",
  });
  const payments: { id: string; transactionId: string; version: number }[] = [];
  for (const amount of amounts) {
    const p = await saved<{
      id: string;
      transactionId: string;
      version: number;
      receivable: typeof service;
    }>(`/receivables/${service.id}/payments`, {
      accountId,
      categoryId,
      amount: money(amount),
      date: "2026-10-07",
      time: "14:32",
      note: "Received",
      expectedReceivableVersion: service.version,
    });
    payments.push(p);
    service = p.receivable;
  }
  return { service, payments, person };
}
beforeAll(async () => {
  await applyMigrations(url);
  await db
    .insert(ledgers)
    .values(ids.map((id) => ({ id, name: "Synthetic merge ledger" })));
  const password = await hashPassword(config.OWNER_PASSWORD),
    cookies: string[] = [];
  for (const [i, role] of (["owner", "editor", "viewer"] as const).entries()) {
    const id = users[i] as string,
      email = `merge-${role}-${id}@example.com`;
    await db.insert(user).values({ id, name: role, email });
    await db.insert(credentials).values({
      userId: id,
      accountId: id,
      providerId: "credential",
      password,
    });
    await db.insert(ledgerMembers).values({ userId: id, ledgerId, role });
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/auth/sign-in/email",
      headers: { origin: config.APP_URL },
      payload: { email, password: config.OWNER_PASSWORD },
    });
    expect(r.statusCode, r.body).toBe(200);
    const c = r.headers["set-cookie"];
    cookies.push(
      (Array.isArray(c) ? c : [c ?? ""]).map((v) => v.split(";")[0]).join("; "),
    );
  }
  [owner, editor, viewer] = cookies as [string, string, string];
  await db
    .insert(ledgerMembers)
    .values({ userId: users[0] as string, ledgerId: other, role: "owner" });
  await app.ready();
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
  await db.insert(accounts).values({
    id: accountId,
    ledgerId,
    name: "Synthetic account",
    type: "bank",
    openingBalance: 10000,
  });
  source = await category("Source");
  destination = await category("Destination");
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

describe("Category merge preview and atomic maintenance", () => {
  it("moves cleared/pending references and active/archived children without changing posted money", async () => {
    const child = await category("Child", "expense", source.id),
      archived = await category("Archived child", "expense", source.id);
    await write(`/categories/${archived.id}/archive`, { expectedVersion: 1 });
    const existing = await category("Existing", "expense", destination.id);
    const a = await transaction(),
      pending = await transaction(source.id, -251, "pending"),
      childEntry = await transaction(child.id, -375);
    const before = await balance(),
      totals = await postedCategoryTotals(
        db,
        ledgerId,
        "2026-10-01",
        "2026-10-31",
      );
    const p = await preview();
    expect(p.summary).toMatchObject({
      ordinaryCleared: 1,
      ordinaryPending: 1,
      splitParents: 0,
      linkedPayments: 0,
    });
    expect(p.summary.children.map((row) => row.id)).toEqual([
      child.id,
      archived.id,
    ]);
    const r = await merge(p);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().source).toMatchObject({
      id: source.id,
      name: "Source",
      version: 2,
    });
    expect(r.json().source.archivedAt).not.toBeNull();
    for (const entry of [a, pending])
      expect((await read(`/transactions/${entry.id}`)).json()).toMatchObject({
        ...entry,
        categoryId: destination.id,
        version: 2,
        updatedAt: expect.any(String),
      });
    expect((await read(`/transactions/${childEntry.id}`)).json()).toEqual(
      childEntry,
    );
    expect((await read(`/categories/${child.id}`)).json()).toMatchObject({
      parentId: destination.id,
      version: 2,
      sortOrder: existing.sortOrder + 1,
    });
    expect((await read(`/categories/${archived.id}`)).json()).toMatchObject({
      parentId: destination.id,
      version: 3,
      archivedAt: expect.any(String),
    });
    expect(await balance()).toBe(before);
    const after = await postedCategoryTotals(
      db,
      ledgerId,
      "2026-10-01",
      "2026-10-31",
    );
    expect([...after.values()].reduce((sum, amount) => sum + amount, 0n)).toBe(
      [...totals.values()].reduce((sum, amount) => sum + amount, 0n),
    );
    expect(after.get(destination.id)).toBe(-125n);
    expect(after.get(child.id)).toBe(-375n);
  });
  it("advances all live split siblings once and retains allocations, IDs and timestamps", async () => {
    const otherCategory = await category("Another"),
      entry = await saved<Transaction>("/transactions", {
        accountId,
        categoryId: null,
        kind: "expense",
        amount: money(-600),
        date: "2026-10-07",
        splits: [
          { categoryId: source.id, amount: money(-100), note: "one" },
          { categoryId: otherCategory.id, amount: money(-300), note: "other" },
          { categoryId: source.id, amount: money(-200), note: "two" },
        ],
      });
    const second = await saved<Transaction>("/transactions", {
      accountId,
      categoryId: null,
      kind: "expense",
      amount: money(-200),
      date: "2026-10-07",
      splits: [
        { categoryId: source.id, amount: money(-100) },
        { categoryId: otherCategory.id, amount: money(-100) },
      ],
    });
    const before = await balance(),
      p = await preview();
    expect(p.summary).toMatchObject({ splitLines: 3, splitParents: 2 });
    expect((await preview()).previewToken).toBe(p.previewToken);
    const r = await merge(p);
    expect(r.statusCode, r.body).toBe(200);
    const result: Transaction = (
      await read(`/transactions/${entry.id}`)
    ).json();
    expect(result).toMatchObject({
      categoryId: null,
      amount: entry.amount,
      version: 2,
    });
    expect(result.splits.map((line) => line.id)).toEqual(
      entry.splits.map((line) => line.id),
    );
    result.splits.forEach((line, index) => {
      expect(line).toMatchObject({
        ...entry.splits[index],
        categoryId: index === 1 ? otherCategory.id : destination.id,
        version: 2,
        updatedAt: result.updatedAt,
      });
    });
    expect(await balance()).toBe(before);
    const another: Transaction = (
      await read(`/transactions/${second.id}`)
    ).json();
    expect(another.version).toBe(2);
    for (const line of another.splits)
      expect([line.version, line.updatedAt]).toEqual([
        another.version,
        another.updatedAt,
      ]);
  });
  it("corrects several linked payments on a written-off service without changing its waiver or balances", async () => {
    const income = await category("Income source", "income"),
      target = await category("Income target", "income");
    const fixture = await linked(income.id);
    expect(
      (
        await write(`/receivables/${fixture.service.id}/write-off`, {
          expectedVersion: fixture.service.version,
          reason: "Keep waiver",
        })
      ).statusCode,
    ).toBe(200);
    await write(`/contacts/${fixture.person.id}/archive`, {
      expectedVersion: 1,
    });
    await write(`/accounts/${accountId}/archive`, { expectedVersion: 1 });
    const beforeService = (
        await read(`/receivables/${fixture.service.id}`)
      ).json(),
      beforeBalance = await balance();
    const priorEvents = (
      await db
        .select()
        .from(receivableEvents)
        .where(eq(receivableEvents.ledgerId, ledgerId))
    ).map((row) => JSON.stringify(row));
    const p = await preview(income.id, target.id);
    expect(p.summary).toMatchObject({ linkedPayments: 2, receivables: 1 });
    const r = await merge(p);
    expect(r.statusCode, r.body).toBe(200);
    const after = (await read(`/receivables/${fixture.service.id}`)).json();
    expect(after).toMatchObject({
      ...beforeService,
      version: beforeService.version + 2,
      updatedAt: expect.any(String),
    });
    expect(after.status).toBe("writtenOff");
    expect(await balance()).toBe(beforeBalance);
    for (const payment of fixture.payments) {
      const pair = (
        await read(`/receivables/${fixture.service.id}/payments/${payment.id}`)
      ).json();
      expect(pair).toMatchObject({
        id: payment.id,
        version: payment.version + 1,
      });
      expect(
        (await read(`/transactions/${payment.transactionId}`)).json(),
      ).toMatchObject({ categoryId: target.id, version: payment.version + 1 });
    }
    const events = await db
      .select()
      .from(receivableEvents)
      .where(eq(receivableEvents.ledgerId, ledgerId))
      .orderBy(receivableEvents.id);
    expect(events.filter((row) => row.action === "paymentEdited")).toHaveLength(
      2,
    );
    for (const encoded of priorEvents)
      expect(events.map((row) => JSON.stringify(row))).toContain(encoded);
    const edits = events.filter((row) => row.action === "paymentEdited");
    edits.forEach((event, index) => {
      expect(eventSnapshotSchema.parse(event.before).payment?.categoryId).toBe(
        income.id,
      );
      expect(eventSnapshotSchema.parse(event.after).payment?.categoryId).toBe(
        target.id,
      );
      expect(event.receivableVersion).toBe(beforeService.version + index + 1);
    });
  });
  it("leaves tombstones and retired split lines unchanged and restores an entry with its archived source", async () => {
    const entry = await transaction(),
      split = await saved<Transaction>("/transactions", {
        accountId,
        categoryId: null,
        kind: "expense",
        amount: money(-200),
        date: "2026-10-07",
        splits: [
          { categoryId: source.id, amount: money(-100) },
          { categoryId: destination.id, amount: money(-100) },
        ],
      });
    await write(`/transactions/${entry.id}`, { expectedVersion: 1 }, "DELETE");
    await write(
      `/transactions/${split.id}`,
      { expectedVersion: 1, splits: null, categoryId: destination.id },
      "PATCH",
    );
    const before = await db
      .select()
      .from(transactionSplits)
      .where(eq(transactionSplits.transactionId, split.id));
    const p = await preview();
    expect(p.summary).toMatchObject({
      excludedTransactions: 1,
      excludedSplitLines: 1,
      ordinaryCleared: 0,
    });
    expect((await merge(p)).statusCode).toBe(200);
    expect(
      await db
        .select()
        .from(transactionSplits)
        .where(eq(transactionSplits.transactionId, split.id)),
    ).toEqual(before);
    expect(
      (await write(`/transactions/${entry.id}/restore`, { expectedVersion: 2 }))
        .statusCode,
    ).toBe(200);
    expect((await read(`/transactions/${entry.id}`)).json()).toMatchObject({
      categoryId: source.id,
      version: 3,
    });
  });
  it("keeps a deleted split parent and every line intact, then restores original archived category references", async () => {
    const entry = await saved<Transaction>("/transactions", {
      accountId,
      categoryId: null,
      kind: "expense",
      amount: money(-200),
      date: "2026-10-07",
      splits: [
        { categoryId: source.id, amount: money(-100) },
        { categoryId: destination.id, amount: money(-100) },
      ],
    });
    expect(
      (
        await write(
          `/transactions/${entry.id}`,
          { expectedVersion: 1 },
          "DELETE",
        )
      ).statusCode,
    ).toBe(204);
    const old = await db
      .select()
      .from(transactionSplits)
      .where(eq(transactionSplits.transactionId, entry.id));
    const p = await preview();
    expect(p.summary).toMatchObject({
      splitParents: 0,
      excludedTransactions: 1,
      excludedSplitLines: 1,
    });
    expect((await merge(p)).statusCode).toBe(200);
    expect(
      await db
        .select()
        .from(transactionSplits)
        .where(eq(transactionSplits.transactionId, entry.id)),
    ).toEqual(old);
    expect(
      (await write(`/transactions/${entry.id}/restore`, { expectedVersion: 2 }))
        .statusCode,
    ).toBe(200);
    const restored: Transaction = (
      await read(`/transactions/${entry.id}`)
    ).json();
    expect(restored.splits.map((line) => line.categoryId)).toEqual([
      source.id,
      destination.id,
    ]);
    for (const line of restored.splits)
      expect([line.version, line.updatedAt]).toEqual([
        restored.version,
        restored.updatedAt,
      ]);
  });
  it("permits cross-parent child merging and subsequent source unarchive without reversing it", async () => {
    const a = await category("A", "expense", source.id),
      b = await category("B", "expense", destination.id),
      entry = await transaction(a.id);
    expect((await merge(await preview(a.id, b.id))).statusCode).toBe(200);
    expect(
      (await write(`/categories/${a.id}/unarchive`, { expectedVersion: 2 }))
        .statusCode,
    ).toBe(200);
    expect((await read(`/transactions/${entry.id}`)).json().categoryId).toBe(
      b.id,
    );
  });
  it.each([
    "same",
    "kind",
    "level",
    "archive",
    "parent",
    "collision",
    "order",
    "version",
  ])("blocks incompatible or bounded merge: %s", async (reason) => {
    let s = source.id,
      d = destination.id;
    if (reason === "same") d = s;
    if (reason === "kind") d = (await category("Income", "income")).id;
    if (reason === "level")
      d = (await category("Child", "expense", destination.id)).id;
    if (reason === "archive")
      await write(`/categories/${d}/archive`, { expectedVersion: 1 });
    if (reason === "parent") {
      s = (await category("A", "expense", source.id)).id;
      d = (await category("B", "expense", destination.id)).id;
      await write(`/categories/${d}/archive`, { expectedVersion: 1 });
      await write(`/categories/${destination.id}/archive`, {
        expectedVersion: 1,
      });
    }
    if (reason === "collision") {
      await category("Same", "expense", source.id);
      const child = await category(" SAME ", "expense", destination.id);
      await write(`/categories/${child.id}/archive`, { expectedVersion: 1 });
    }
    if (reason === "order") {
      await category("Move", "expense", source.id);
      const child = await category("Existing", "expense", destination.id);
      await db
        .update(categories)
        .set({ sortOrder: 2_147_483_647 })
        .where(eq(categories.id, child.id));
    }
    if (reason === "version")
      await db
        .update(categories)
        .set({ version: 2_147_483_647 })
        .where(eq(categories.id, s));
    const p = await preview(s, d);
    expect(p.canMerge).toBe(false);
    expect(p.previewToken).toBeNull();
    expect(p.blockers.length).toBeGreaterThan(0);
    const before = await snapshot();
    const r = await write(`/categories/${s}/merge`, {
      ...body(p),
      previewToken: "a".repeat(64),
    });
    expect(r.statusCode).toBe(409);
    expect(await snapshot()).toEqual(before);
  });
  it.each([
    "insert",
    "edit",
    "delete",
    "restore",
    "newChild",
    "reparent",
    "destinationSibling",
  ])(
    "rejects a stale preview after %s even without root version changes",
    async (change) => {
      const entry = await transaction(),
        child = await category("Child", "expense", source.id);
      if (change === "restore")
        await write(
          `/transactions/${entry.id}`,
          { expectedVersion: 1 },
          "DELETE",
        );
      const p = await preview();
      if (change === "insert") await transaction();
      if (change === "edit")
        await write(
          `/transactions/${entry.id}`,
          { expectedVersion: 1, note: "Changed" },
          "PATCH",
        );
      if (change === "delete")
        await write(
          `/transactions/${entry.id}`,
          { expectedVersion: 1 },
          "DELETE",
        );
      if (change === "restore")
        await write(`/transactions/${entry.id}/restore`, {
          expectedVersion: 2,
        });
      if (change === "newChild") await category("New", "expense", source.id);
      if (change === "reparent")
        await write(
          `/categories/${child.id}`,
          { expectedVersion: 1, parentId: destination.id },
          "PATCH",
        );
      if (change === "destinationSibling")
        await category("Sibling", "expense", destination.id);
      expect((await read(`/categories/${source.id}`)).json().version).toBe(
        p.expectedSourceVersion,
      );
      expect((await read(`/categories/${destination.id}`)).json().version).toBe(
        p.expectedDestinationVersion,
      );
      const before = await snapshot();
      expect((await merge(p)).statusCode).toBe(409);
      expect(await snapshot()).toEqual(before);
    },
  );
  it("does not invalidate a preview for unrelated ledger activity", async () => {
    const otherCategory = await category("Unrelated"),
      p = await preview();
    await transaction(otherCategory.id);
    expect((await preview()).previewToken).toBe(p.previewToken);
    expect((await merge(p)).statusCode).toBe(200);
  });
  it("rechecks linked service changes and multi-payment parent-version overflow", async () => {
    const income = await category("Income", "income"),
      target = await category("Target", "income"),
      f = await linked(income.id);
    const p = await preview(income.id, target.id);
    await write(`/receivables/${f.service.id}/write-off`, {
      expectedVersion: f.service.version,
    });
    expect((await merge(p)).statusCode).toBe(409);
    await db
      .update(receivables)
      .set({ version: 2_147_483_646 })
      .where(eq(receivables.id, f.service.id));
    const latest = await preview(income.id, target.id);
    expect(latest.canMerge).toBe(false);
    expect(latest.blockers.map((row) => row.code)).toContain("versionLimit");
  });
  it("requires authentication, editor access, Origin, keys, strict bodies and scoped targets", async () => {
    const p = await preview();
    expect(
      (
        await read(
          `/categories/${source.id}/merge-preview?destinationCategoryId=${destination.id}`,
          "",
        )
      ).statusCode,
    ).toBe(401);
    expect((await preview(source.id, destination.id, viewer)).canMerge).toBe(
      true,
    );
    expect((await merge(p, viewer)).statusCode).toBe(403);
    expect((await merge(p, "")).statusCode).toBe(401);
    for (const extra of [
      { origin: "https://foreign.invalid" },
      { origin: "" },
      { "idempotency-key": "" },
    ]) {
      const r = await app.inject({
        method: "POST",
        url: `${base()}/categories/${source.id}/merge`,
        headers: { ...headers(), ...extra },
        payload: body(p),
      });
      expect([400, 403]).toContain(r.statusCode);
    }
    expect(
      (
        await write(`/categories/${source.id}/merge`, {
          ...body(p),
          amount: money(1),
        })
      ).statusCode,
    ).toBe(400);
    for (const ledger of [other, foreign])
      expect(
        (
          await read(
            `/categories/${source.id}/merge-preview?destinationCategoryId=${destination.id}`,
            owner,
            ledger,
          )
        ).statusCode,
      ).toBe(404);
    const foreignId = newId();
    await db.insert(categories).values({
      id: foreignId,
      ledgerId: other,
      name: "Foreign",
      kind: "expense",
    });
    expect(
      (
        await read(
          `/categories/${source.id}/merge-preview?destinationCategoryId=${foreignId}`,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await write(`/categories/${source.id}/merge`, {
          ...body(p),
          destinationCategoryId: foreignId,
        })
      ).statusCode,
    ).toBe(404);
    const editorPreview = await preview(source.id, destination.id, editor);
    expect((await merge(editorPreview, editor)).statusCode).toBe(200);
  });
  it("binds the preview to its actor and normalizes UUID casing", async () => {
    const p = await preview();
    expect((await merge(p, editor)).statusCode).toBe(409);
    const upper = await preview(
      source.id.toUpperCase(),
      destination.id.toUpperCase(),
    );
    expect(upper.previewToken).toBe(p.previewToken);
    expect(
      (
        await write(`/categories/${source.id.toUpperCase()}/merge`, {
          ...body(p),
          destinationCategoryId: destination.id.toUpperCase(),
        })
      ).statusCode,
    ).toBe(200);
  });
  it("replays concurrent and restart retries once, rejects key changes, and rechecks revoked access", async () => {
    await transaction();
    const p = await preview(),
      key = newId();
    const results = await Promise.all([
      merge(p, owner, key),
      merge(p, owner, key),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(results[0]?.json()).toEqual(results[1]?.json());
    expect((await merge(p, owner, key)).json()).toEqual(results[0]?.json());
    const fresh = createDatabase(url);
    try {
      expect(
        (
          await mergeCategories(
            fresh.db,
            { actorId: users[0] as string, ledgerId, key },
            source.id,
            body(p) as Parameters<typeof mergeCategories>[3],
          )
        ).body,
      ).toEqual(results[0]?.json());
    } finally {
      await fresh.pool.end();
    }
    expect(
      (
        await write(
          `/categories/${source.id}/merge`,
          { ...body(p), previewToken: "a".repeat(64) },
          "POST",
          owner,
          key,
        )
      ).statusCode,
    ).toBe(409);
    await db
      .update(ledgerMembers)
      .set({ role: "viewer" })
      .where(
        and(
          eq(ledgerMembers.ledgerId, ledgerId),
          eq(ledgerMembers.userId, users[0] as string),
        ),
      );
    expect((await merge(p, owner, key)).statusCode).toBe(403);
  });
  it("serializes merge against an existing edit without a lost version", async () => {
    const entry = await transaction(),
      p = await preview();
    const results = await Promise.all([
      merge(p),
      write(
        `/transactions/${entry.id}`,
        { expectedVersion: 1, note: "Concurrent correction" },
        "PATCH",
      ),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((await read(`/transactions/${entry.id}`)).json().version).toBe(2);
    expect(await balance()).toBe(9875);
  });
  it.each([
    "assignment",
    "split",
    "payment",
    "delete",
    "archive",
    "undo",
    "merge",
  ])(
    "serializes merge against %s without partial writes or deadlocks",
    async (operation) => {
      let s = source.id,
        d = destination.id;
      let competing: () => ReturnType<typeof write>;
      if (operation === "assignment")
        competing = () =>
          write("/transactions", {
            accountId,
            categoryId: s,
            kind: "expense",
            amount: money(-100),
            date: "2026-10-07",
          });
      else if (operation === "archive")
        competing = () =>
          write(`/categories/${s}/archive`, { expectedVersion: 1 });
      else if (operation === "merge") {
        const third = await category("Third");
        const second = await preview(s, third.id);
        competing = () => merge(second);
      } else if (operation === "payment") {
        s = (await category("Income", "income")).id;
        d = (await category("Target", "income")).id;
        const f = await linked(s, [1000]),
          payment = f.payments[0];
        if (!payment) throw new Error("Missing synthetic payment");
        competing = () =>
          write(
            `/receivables/${f.service.id}/payments/${payment.id}`,
            {
              accountId,
              categoryId: s,
              amount: money(1000),
              date: "2026-10-07",
              note: "Correction",
              time: null,
              expectedVersion: payment.version,
              expectedReceivableVersion: f.service.version,
            },
            "PATCH",
          );
      } else {
        const entry =
          operation === "split"
            ? await saved<Transaction>("/transactions", {
                accountId,
                categoryId: null,
                kind: "expense",
                amount: money(-200),
                date: "2026-10-07",
                splits: [
                  { categoryId: s, amount: money(-100) },
                  { categoryId: d, amount: money(-100) },
                ],
              })
            : await transaction();
        if (operation === "undo") {
          expect(
            (
              await write(
                `/transactions/${entry.id}`,
                { expectedVersion: 1 },
                "DELETE",
              )
            ).statusCode,
          ).toBe(204);
          competing = () =>
            write(`/transactions/${entry.id}/restore`, { expectedVersion: 2 });
        } else
          competing = () =>
            write(
              `/transactions/${entry.id}`,
              {
                expectedVersion: 1,
                ...(operation === "split" ? { note: "Split correction" } : {}),
              },
              operation === "delete" ? "DELETE" : "PATCH",
            );
      }
      const p = await preview(s, d);
      const [result, correction] = await Promise.all([merge(p), competing()]);
      if (operation === "undo") {
        expect([200, 409]).toContain(result.statusCode);
        expect(correction.statusCode).toBe(200);
        expect(await balance()).toBe(9875);
      } else {
        expect([200, 201, 204, 409]).toContain(correction.statusCode);
        expect(
          [result.statusCode, correction.statusCode].filter(
            (status) => status === 409,
          ),
        ).toHaveLength(1);
      }
      const current = (await read(`/categories`)).json().items as Category[];
      expect(current.find((row) => row.id === s)?.archivedAt !== null).toBe(
        result.statusCode === 200 ||
          operation === "archive" ||
          operation === "merge",
      );
      const rows = await db
        .select()
        .from(transactions)
        .where(eq(transactions.ledgerId, ledgerId));
      for (const row of rows.filter((r) => !r.deletedAt && !r.isSplit))
        expect([s, d]).toContain(row.categoryId);
      if (result.statusCode === 200 && operation !== "undo")
        expect(
          rows.filter((r) => !r.deletedAt && r.categoryId === s),
        ).toHaveLength(0);
    },
  );
  it("preserves a deleted linked pair and deleted child while merging an already archived source", async () => {
    const income = await category("Income", "income"),
      target = await category("Target", "income"),
      child = await category("Deleted child", "income", income.id),
      f = await linked(income.id);
    expect(
      (await write(`/categories/${child.id}`, { expectedVersion: 1 }, "DELETE"))
        .statusCode,
    ).toBe(204);
    const payment = f.payments[0];
    if (!payment) throw new Error("Missing fixture");
    expect(
      (
        await write(
          `/receivables/${f.service.id}/payments/${payment.id}`,
          {
            expectedVersion: payment.version,
            expectedReceivableVersion: f.service.version,
          },
          "DELETE",
        )
      ).statusCode,
    ).toBe(204);
    expect(
      (await write(`/categories/${income.id}/archive`, { expectedVersion: 1 }))
        .statusCode,
    ).toBe(200);
    const before = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, payment.transactionId)),
      oldChild = await db
        .select()
        .from(categories)
        .where(eq(categories.id, child.id)),
      archived = (await preview(income.id, target.id)).source.archivedAt;
    const p = await preview(income.id, target.id);
    expect(p.summary).toMatchObject({
      linkedPayments: 1,
      excludedPayments: 1,
      excludedChildren: 1,
    });
    const result = await merge(p);
    expect(result.statusCode).toBe(200);
    expect(result.json().source.archivedAt).toBe(archived);
    expect(
      await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, payment.transactionId)),
    ).toEqual(before);
    expect(
      await db.select().from(categories).where(eq(categories.id, child.id)),
    ).toEqual(oldChild);
    const service = (await read(`/receivables/${f.service.id}`)).json();
    expect(
      (
        await write(
          `/receivables/${f.service.id}/payments/${payment.id}/restore`,
          {
            expectedVersion: payment.version + 1,
            expectedReceivableVersion: service.version,
          },
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await read(`/transactions/${payment.transactionId}`)).json().categoryId,
    ).toBe(income.id);
  });
  it("rolls back category moves, linked pairs, history and source archival if receipt insertion fails", async () => {
    const income = await category("Income", "income"),
      target = await category("Target", "income");
    await linked(income.id);
    const p = await preview(income.id, target.id),
      key = newId(),
      before = await snapshot();
    await pool.query(
      `CREATE FUNCTION merge_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.ledger_id='${ledgerId}'::uuid THEN RAISE EXCEPTION 'Synthetic receipt failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      "CREATE TRIGGER merge_receipt_failure BEFORE INSERT ON write_receipts FOR EACH ROW EXECUTE FUNCTION merge_receipt_failure()",
    );
    try {
      expect((await merge(p, owner, key)).statusCode).toBe(500);
      expect(await snapshot()).toEqual(before);
    } finally {
      await pool.query("DROP TRIGGER merge_receipt_failure ON write_receipts");
      await pool.query("DROP FUNCTION merge_receipt_failure()");
    }
    expect((await merge(p, owner, key)).statusCode).toBe(200);
  });
});
