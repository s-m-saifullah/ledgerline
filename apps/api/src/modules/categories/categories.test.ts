import {
  type Category,
  categoryListSchema,
  categorySchema,
  newId,
} from "@ledgerline/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { readConfig } from "../../config";
import { createDatabase } from "../../db/client";
import { applyMigrations } from "../../db/migrate";
import {
  categories,
  account as credentials,
  ledgerMembers,
  ledgers,
  session,
  user,
  writeReceipts,
} from "../../db/schema";
import { hashPassword } from "../auth/password";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("/ledgerline_test"))
  throw new Error(
    "Categories tests require the dedicated ledgerline_test database.",
  );
const config = readConfig({
  NODE_ENV: "test",
  DATABASE_URL: url,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "categories-test-secret-only-00000000000000000",
  OWNER_EMAIL: "categories-owner@example.com",
  OWNER_PASSWORD: "Categories-test-password-000",
  OWNER_NAME: "Categories owner",
});
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
let ledgerId = "";
let ownerId = "";
let ownerCookie = "";
let editorCookie = "";
let viewerCookie = "";
const secondLedger = newId();
const foreignLedger = newId();
const base = (ledger = ledgerId) => `/api/v1/ledgers/${ledger}/categories`;
const input = (
  name = "Food",
  kind = "expense",
  parentId: string | null = null,
) => ({ name, kind, parentId, icon: "utensils", color: "#0D9488" });
const headers = (cookie = ownerCookie, key = newId()) => ({
  "content-type": "application/json",
  cookie,
  origin: config.APP_URL,
  "idempotency-key": key,
});
const create = (
  payload: unknown = input(),
  ledger = ledgerId,
  cookie = ownerCookie,
  key = newId(),
) =>
  app.inject({
    method: "POST",
    url: base(ledger),
    headers: headers(cookie, key),
    payload: JSON.stringify(payload),
  });
const edit = (
  id: string,
  payload: unknown = { name: "Renamed", expectedVersion: 1 },
  ledger = ledgerId,
  cookie = ownerCookie,
  key = newId(),
) =>
  app.inject({
    method: "PATCH",
    url: `${base(ledger)}/${id}`,
    headers: headers(cookie, key),
    payload: JSON.stringify(payload),
  });
const archive = (
  id: string,
  expectedVersion = 1,
  ledger = ledgerId,
  cookie = ownerCookie,
  key = newId(),
) =>
  app.inject({
    method: "POST",
    url: `${base(ledger)}/${id}/archive`,
    headers: headers(cookie, key),
    payload: { expectedVersion },
  });
const unarchive = (
  id: string,
  expectedVersion = 2,
  ledger = ledgerId,
  cookie = ownerCookie,
  key = newId(),
) =>
  app.inject({
    method: "POST",
    url: `${base(ledger)}/${id}/unarchive`,
    headers: headers(cookie, key),
    payload: { expectedVersion },
  });
const read = (path: string, cookie = ownerCookie) =>
  app.inject({ url: path, headers: { cookie } });
async function saved(
  payload: unknown = input(),
  ledger = ledgerId,
): Promise<Category> {
  const response = await create(payload, ledger);
  expect(response.statusCode).toBe(201);
  return categorySchema.parse(response.json());
}
async function signIn(email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-in/email",
    headers: { origin: config.APP_URL },
    payload: { email, password: config.OWNER_PASSWORD },
  });
  expect(response.statusCode).toBe(200);
  const cookie = response.headers["set-cookie"];
  return (Array.isArray(cookie) ? cookie : [cookie ?? ""])
    .map((value) => value.split(";")[0])
    .join("; ");
}

const fixtureUsers = [newId(), newId(), newId()];
const fixtureLedgers = [newId(), secondLedger, foreignLedger];
beforeAll(async () => {
  await applyMigrations(url);
  ledgerId = fixtureLedgers[0] ?? "";
  ownerId = fixtureUsers[0] ?? "";
  await db.insert(ledgers).values(
    fixtureLedgers.map((id) => ({
      id,
      name: "Synthetic categories test ledger",
    })),
  );
  const password = await hashPassword(config.OWNER_PASSWORD);
  for (const [index, role] of (
    ["owner", "editor", "viewer"] as const
  ).entries()) {
    const id = fixtureUsers[index];
    if (!id) throw new Error("Missing fixture ID");
    const email = `categories-${role}-${id}@example.com`;
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
    .values({ userId: ownerId, ledgerId: secondLedger, role: "owner" });
  await app.ready();
  ownerCookie = await signIn(`categories-owner-${ownerId}@example.com`);
  editorCookie = await signIn(
    `categories-editor-${fixtureUsers[1]}@example.com`,
  );
  viewerCookie = await signIn(
    `categories-viewer-${fixtureUsers[2]}@example.com`,
  );
});
const fixtureScope = inArray(categories.ledgerId, fixtureLedgers);
beforeEach(async () => {
  // Clear only this suite's synthetic rows, retaining every unrelated ledger.
  await db.delete(categories).where(fixtureScope);
  await db
    .delete(writeReceipts)
    .where(inArray(writeReceipts.ledgerId, fixtureLedgers));
  await db
    .update(ledgers)
    .set({ deletedAt: null })
    .where(inArray(ledgers.id, fixtureLedgers));
  await db
    .update(ledgerMembers)
    .set({ deletedAt: null, role: "owner" })
    .where(
      and(
        eq(ledgerMembers.ledgerId, ledgerId),
        eq(ledgerMembers.userId, ownerId),
      ),
    );
});
afterAll(async () => {
  await app.close();
  await db.delete(categories).where(fixtureScope);
  await db
    .delete(writeReceipts)
    .where(inArray(writeReceipts.ledgerId, fixtureLedgers));
  await db.delete(session).where(inArray(session.userId, fixtureUsers));
  await db.delete(credentials).where(inArray(credentials.userId, fixtureUsers));
  await db
    .delete(ledgerMembers)
    .where(inArray(ledgerMembers.ledgerId, fixtureLedgers));
  await db.delete(ledgers).where(inArray(ledgers.id, fixtureLedgers));
  await db.delete(user).where(inArray(user.id, fixtureUsers));
  await pool.end();
});
const batch = (
  action: "reorder" | "starter-set",
  payload: unknown,
  ledger = ledgerId,
  cookie = ownerCookie,
  key = newId(),
) =>
  app.inject({
    method: "POST",
    url: `${base(ledger)}/${action}`,
    headers: headers(cookie, key),
    payload: JSON.stringify(payload),
  });
const orderBody = (
  items: Category[],
  kind = "expense",
  parentId: string | null = null,
) => ({
  kind,
  parentId,
  items: items.map((row) => ({ id: row.id, expectedVersion: row.version })),
});
async function mutations(
  category: Category,
  ledger = ledgerId,
  cookie = ownerCookie,
) {
  return Promise.all([
    create(input("New"), ledger, cookie),
    edit(
      category.id,
      { name: "Edit", expectedVersion: category.version },
      ledger,
      cookie,
    ),
    archive(category.id, category.version, ledger, cookie),
    unarchive(category.id, category.version, ledger, cookie),
    batch("reorder", orderBody([category]), ledger, cookie),
    batch("starter-set", { starterSet: "basic" }, ledger, cookie),
  ]);
}
describe("Categories API", () => {
  it("starts empty and round-trips roots and children of both kinds", async () => {
    expect((await read(base())).json()).toEqual({
      items: [],
      nextCursor: null,
    });
    for (const kind of ["income", "expense"]) {
      const root = await saved(input("  Food  ", kind));
      const child = await saved(input("Groceries", kind, root.id));
      expect(root.name).toBe("Food");
      expect(root.version).toBe(1);
      expect(root.sortOrder).toBe(0);
      expect(child.parentId).toBe(root.id);
      expect((await read(`${base()}/${child.id}`)).json()).toEqual(child);
    }
    expect(
      categoryListSchema.parse((await read(base())).json()).items,
    ).toHaveLength(4);
  });
  it("rejects invalid names, kind, icon/color, IDs, unknown fields and pagination", async () => {
    for (const payload of [
      input(" "),
      input("a".repeat(101)),
      input("Food", "transfer"),
      input("Food", "expense", newId()),
      { ...input(), icon: "<script>" },
      { ...input(), color: "red" },
      { ...input(), ledgerId: secondLedger },
    ]) {
      const response = await create(payload);
      expect([400, 404]).toContain(response.statusCode);
      expect(response.headers["content-type"]).toContain(
        "application/problem+json",
      );
    }
    for (const query of [
      "limit=0",
      "limit=101",
      "cursor=bad",
      "kind=transfer",
      "status=deleted",
    ])
      expect((await read(`${base()}?${query}`)).statusCode).toBe(400);
    expect((await read(`${base()}/bad`)).statusCode).toBe(400);
    expect(await db.select().from(categories).where(fixtureScope)).toHaveLength(
      0,
    );
  });
  it("requires authentication on all eight endpoints", async () => {
    const row = await saved();
    for (const response of [
      await read(base(), ""),
      await read(`${base()}/${row.id}`, ""),
      ...(await mutations(row, ledgerId, "")),
    ])
      expect(response.statusCode).toBe(401);
  });
  it("allows viewer reads and rejects every viewer mutation", async () => {
    const row = await saved();
    expect((await read(base(), viewerCookie)).statusCode).toBe(200);
    expect((await read(`${base()}/${row.id}`, viewerCookie)).statusCode).toBe(
      200,
    );
    for (const response of await mutations(row, ledgerId, viewerCookie))
      expect(response.statusCode).toBe(403);
  });
  it("allows all six editor mutations", async () => {
    const starter = await batch(
      "starter-set",
      { starterSet: "basic" },
      ledgerId,
      editorCookie,
    );
    expect(starter.statusCode).toBe(201);
    const row = categorySchema.parse(
      (await create(input("Editor"), ledgerId, editorCookie)).json(),
    );
    expect(
      (
        await edit(
          row.id,
          { name: "Editor edit", expectedVersion: 1 },
          ledgerId,
          editorCookie,
        )
      ).statusCode,
    ).toBe(200);
    const siblings = categoryListSchema.parse(
      (await read(`${base()}?kind=expense&status=active`)).json(),
    ).items;
    expect(
      (await batch("reorder", orderBody(siblings), ledgerId, editorCookie))
        .statusCode,
    ).toBe(200);
    expect((await archive(row.id, 3, ledgerId, editorCookie)).statusCode).toBe(
      200,
    );
    expect(
      (await unarchive(row.id, 4, ledgerId, editorCookie)).statusCode,
    ).toBe(200);
  });
  it("denies inaccessible ledgers for every endpoint", async () => {
    const row = await saved();
    for (const response of [
      await read(base(foreignLedger)),
      await read(`${base(foreignLedger)}/${row.id}`),
      ...(await mutations(row, foreignLedger)),
    ])
      expect(response.statusCode).toBe(404);
  });
  it("scopes reads, target writes, parents, reorder and starter creation across accessible ledgers", async () => {
    const local = await saved();
    const other = await saved(input("Other"), secondLedger);
    expect((await read(base())).json().items).toEqual([local]);
    expect((await read(`${base()}/${other.id}`)).statusCode).toBe(404);
    expect((await edit(other.id)).statusCode).toBe(404);
    expect((await archive(other.id)).statusCode).toBe(404);
    expect((await unarchive(other.id)).statusCode).toBe(404);
    expect((await create(input("Child", "expense", other.id))).statusCode).toBe(
      404,
    );
    expect(
      (await edit(local.id, { parentId: other.id, expectedVersion: 1 }))
        .statusCode,
    ).toBe(404);
    expect((await batch("reorder", orderBody([other]))).statusCode).toBe(404);
    expect(
      (await batch("starter-set", { starterSet: "basic" }, secondLedger))
        .statusCode,
    ).toBe(409);
    expect((await read(`${base(secondLedger)}/${other.id}`)).json()).toEqual(
      other,
    );
  });
  it("rejects wrong-kind parents, self-parenting, cycles and third levels on create and update", async () => {
    const root = await saved();
    const child = await saved(input("Child", "expense", root.id));
    const income = await saved(input("Salary", "income"));
    expect((await create(input("Wrong", "income", root.id))).statusCode).toBe(
      409,
    );
    expect((await create(input("Third", "expense", child.id))).statusCode).toBe(
      409,
    );
    for (const parentId of [root.id, child.id, income.id])
      expect(
        (await edit(root.id, { parentId, expectedVersion: 1 })).statusCode,
      ).toBe(409);
    expect(
      (await edit(child.id, { parentId: child.id, expectedVersion: 1 }))
        .statusCode,
    ).toBe(409);
    const other = await saved(input("Other"));
    expect(
      (await edit(root.id, { parentId: other.id, expectedVersion: 1 }))
        .statusCode,
    ).toBe(409);
    expect(
      (await edit(other.id, { parentId: child.id, expectedVersion: 1 }))
        .statusCode,
    ).toBe(409);
    expect((await read(`${base()}/${root.id}`)).json()).toEqual(root);
  });
  it("enforces case-insensitive sibling names including archives without forbidding other groups", async () => {
    const root = await saved();
    expect((await create(input(" fOoD "))).statusCode).toBe(409);
    const other = await saved(input("Other"));
    expect(
      (await edit(other.id, { name: "FOOD", expectedVersion: 1 })).statusCode,
    ).toBe(409);
    await saved(input("Food", "income"));
    const child = await saved(input("Child", "expense", root.id));
    expect((await create(input("child", "expense", root.id))).statusCode).toBe(
      409,
    );
    await saved(input("Child", "expense", other.id));
    expect(
      (await edit(child.id, { parentId: other.id, expectedVersion: 1 }))
        .statusCode,
    ).toBe(409);
    expect((await archive(other.id)).statusCode).toBe(409);
    await archive(child.id);
    expect((await create(input("CHILD", "expense", root.id))).statusCode).toBe(
      409,
    );
  });
  it("moves leaf categories and appends them to their new sibling group", async () => {
    const root = await saved();
    const other = await saved(input("Other"));
    await saved(input("First", "expense", other.id));
    const child = await saved(input("Child", "expense", root.id));
    const moved = await edit(child.id, {
      parentId: other.id,
      expectedVersion: 1,
      icon: null,
      color: null,
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({
      parentId: other.id,
      sortOrder: 1,
      version: 2,
      icon: null,
      color: null,
    });
    expect(
      (await edit(child.id, { parentId: null, expectedVersion: 2 })).json(),
    ).toMatchObject({ parentId: null, sortOrder: 2 });
  });
  it("rejects assignment to archived parents and retains archived labels and hierarchy", async () => {
    const root = await saved();
    const child = await saved(input("Child", "expense", root.id));
    expect((await archive(root.id)).statusCode).toBe(409);
    const archivedChild = (await archive(child.id)).json();
    const archivedRoot = (await archive(root.id)).json();
    expect(archivedRoot.name).toBe(root.name);
    expect(archivedChild.parentId).toBe(root.id);
    expect((await read(`${base()}/${child.id}`)).json()).toEqual(archivedChild);
    expect((await read(`${base()}?status=active`)).json().items).toEqual([]);
    expect((await read(`${base()}?status=archived`)).json().items).toHaveLength(
      2,
    );
    expect(
      (await create(input("New child", "expense", root.id))).statusCode,
    ).toBe(409);
    const leaf = await saved(input("Leaf"));
    expect(
      (await edit(leaf.id, { parentId: root.id, expectedVersion: 1 }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await edit(child.id, { name: "Historical child", expectedVersion: 2 })
      ).json(),
    ).toMatchObject({
      archivedAt: archivedChild.archivedAt,
      parentId: root.id,
    });
    expect((await archive(root.id, 2)).statusCode).toBe(409);
  });
  it("restores roots before children, preserves labels and metadata and appends without restoring children implicitly", async () => {
    for (const kind of ["income", "expense"]) {
      const root = await saved(input("Root", kind));
      const child = await saved(input("Child", kind, root.id));
      await archive(child.id);
      await archive(root.id);
      const sibling = await saved(input("Active sibling", kind));
      const blocked = await unarchive(child.id);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().errors[0].field).toBe("parentId");
      const restoredRoot = categorySchema.parse(
        (await unarchive(root.id)).json(),
      );
      expect(restoredRoot).toMatchObject({
        id: root.id,
        name: root.name,
        kind,
        icon: root.icon,
        color: root.color,
        parentId: null,
        createdAt: root.createdAt,
        archivedAt: null,
        version: 3,
      });
      expect(restoredRoot.sortOrder).toBeGreaterThan(sibling.sortOrder);
      expect(
        (await read(`${base()}/${child.id}`)).json().archivedAt,
      ).not.toBeNull();
      const restoredChild = categorySchema.parse(
        (await unarchive(child.id)).json(),
      );
      expect(restoredChild).toMatchObject({
        id: child.id,
        name: child.name,
        kind,
        icon: child.icon,
        color: child.color,
        parentId: root.id,
        createdAt: child.createdAt,
        archivedAt: null,
        version: 3,
      });
      expect(
        (await read(`${base()}?kind=${kind}&status=active`)).json().items,
      ).toHaveLength(3);
      expect(
        (await read(`${base()}?kind=${kind}&status=archived`)).json().items,
      ).toEqual([]);
      expect((await read(`${base()}/${sibling.id}`)).json()).toEqual(sibling);
    }
  });
  it("rejects stale or already-active unarchives and replays simultaneous restores exactly once", async () => {
    const row = await saved();
    await archive(row.id);
    expect((await unarchive(row.id, 1)).statusCode).toBe(409);
    const key = newId();
    const results = await Promise.all([
      unarchive(row.id, 2, ledgerId, ownerCookie, key),
      unarchive(
        row.id.toUpperCase(),
        2,
        ledgerId.toUpperCase(),
        ownerCookie,
        key,
      ),
    ]);
    expect(results.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(results[0]?.json()).toEqual(results[1]?.json());
    expect(
      results.filter(
        (response) => response.headers["idempotency-replayed"] === "true",
      ),
    ).toHaveLength(1);
    expect((await read(`${base()}/${row.id}`)).json().version).toBe(3);
    expect((await unarchive(row.id, 3)).statusCode).toBe(409);
    expect(
      (await unarchive(row.id, 3, ledgerId, ownerCookie, key)).statusCode,
    ).toBe(409);
    await archive(row.id, 3);
    const replay = await unarchive(row.id, 2, ledgerId, ownerCookie, key);
    expect(replay.json()).toEqual(results[0]?.json());
    expect((await read(`${base()}/${row.id}`)).json()).toMatchObject({
      version: 4,
      archivedAt: expect.any(String),
    });
    await db
      .update(ledgerMembers)
      .set({ role: "viewer" })
      .where(
        and(
          eq(ledgerMembers.ledgerId, ledgerId),
          eq(ledgerMembers.userId, ownerId),
        ),
      );
    expect(
      (await unarchive(row.id, 2, ledgerId, ownerCookie, key)).statusCode,
    ).toBe(403);
  });
  it("serializes restoring a child against archiving its parent", async () => {
    const root = await saved();
    const child = await saved(input("Child", "expense", root.id));
    await archive(child.id);
    const results = await Promise.all([unarchive(child.id), archive(root.id)]);
    expect(results.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);
    const latestRoot = (await read(`${base()}/${root.id}`)).json();
    const latestChild = (await read(`${base()}/${child.id}`)).json();
    if (latestRoot.archivedAt) expect(latestChild.archivedAt).not.toBeNull();
    else expect(latestChild.archivedAt).toBeNull();
  });
  it("rejects restoring a child whose parent is tombstoned without changing the child or recording a receipt", async () => {
    const root = await saved();
    const child = await saved(input("Child", "expense", root.id));
    const archivedChild = (await archive(child.id)).json();
    await db
      .update(categories)
      .set({ deletedAt: new Date() })
      .where(and(fixtureScope, eq(categories.id, root.id)));
    const key = newId();
    expect(
      (await unarchive(child.id, 2, ledgerId, ownerCookie, key)).statusCode,
    ).toBe(404);
    expect((await read(`${base()}/${child.id}`)).json()).toEqual(archivedChild);
    expect(
      await db
        .select()
        .from(writeReceipts)
        .where(
          and(eq(writeReceipts.ledgerId, ledgerId), eq(writeReceipts.key, key)),
        ),
    ).toHaveLength(0);
  });
  it("creates duplicate concurrent intents only once and rejects key reuse with changed input", async () => {
    const key = newId();
    const responses = await Promise.all([
      create(input(), ledgerId, ownerCookie, key),
      create(input(), ledgerId.toUpperCase(), ownerCookie, key),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([
      201, 201,
    ]);
    expect(responses[0]?.json()).toEqual(responses[1]?.json());
    expect(
      responses.filter(
        (response) => response.headers["idempotency-replayed"] === "true",
      ),
    ).toHaveLength(1);
    expect(
      (await create(input("Changed"), ledgerId, ownerCookie, key)).statusCode,
    ).toBe(409);
    const duplicates = await Promise.all([
      create(input("Concurrent")),
      create(input(" concurrent "), ledgerId.toUpperCase()),
    ]);
    expect(duplicates.map((response) => response.statusCode).sort()).toEqual([
      201, 409,
    ]);
  });
  it("serializes concurrent parent changes and preserves two-level hierarchy", async () => {
    const a = await saved(input("A"));
    const b = await saved(input("B"));
    const responses = await Promise.all([
      edit(a.id, { parentId: b.id, expectedVersion: 1 }),
      edit(b.id, { parentId: a.id, expectedVersion: 1 }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);
  });
  it("guards stale edits and archives and safely replays both", async () => {
    const row = await saved();
    const key = newId();
    const body = { name: "Renamed", expectedVersion: 1 };
    const updated = await edit(row.id, body, ledgerId, ownerCookie, key);
    expect(updated.statusCode).toBe(200);
    expect(
      (await edit(row.id, body, ledgerId, ownerCookie, key)).json(),
    ).toEqual(updated.json());
    const stale = await edit(row.id, body);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().errors[0].field).toBe("expectedVersion");
    expect((await archive(row.id)).statusCode).toBe(409);
    const archiveKey = newId();
    const archived = await archive(
      row.id,
      2,
      ledgerId,
      ownerCookie,
      archiveKey,
    );
    expect(
      (await archive(row.id, 2, ledgerId, ownerCookie, archiveKey)).json(),
    ).toEqual(archived.json());
  });
  it("permits only one simultaneous edit from the same expected version", async () => {
    const row = await saved();
    const responses = await Promise.all([
      edit(row.id, { name: "A", expectedVersion: 1 }),
      edit(row.id, { name: "B", expectedVersion: 1 }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);
  });
  it("reorders a complete sibling group atomically and replays without advancing versions again", async () => {
    const a = await saved(input("A"));
    const b = await saved(input("B"));
    const income = await saved(input("Income", "income"));
    const child = await saved(input("Child", "expense", a.id));
    const key = newId();
    const body = orderBody([b, a]);
    const first = await batch("reorder", body, ledgerId, ownerCookie, key);
    expect(first.statusCode).toBe(200);
    expect(
      first
        .json()
        .items.map((row: Category) => [row.id, row.sortOrder, row.version]),
    ).toEqual([
      [b.id, 0, 2],
      [a.id, 1, 2],
    ]);
    expect(
      (await batch("reorder", body, ledgerId, ownerCookie, key)).json(),
    ).toEqual(first.json());
    expect((await read(`${base()}/${income.id}`)).json()).toEqual(income);
    expect((await read(`${base()}/${child.id}`)).json()).toEqual(child);
  });
  it("rejects incomplete, duplicate, mixed-group and stale reorder lists without partial changes or receipts", async () => {
    const a = await saved(input("A"));
    const b = await saved(input("B"));
    const income = await saved(input("Income", "income"));
    const child = await saved(input("Child", "expense", a.id));
    for (const body of [
      orderBody([a]),
      orderBody([a, income]),
      orderBody([a, child]),
      {
        ...orderBody([a, b]),
        items: [
          { id: a.id, expectedVersion: 1 },
          { id: b.id, expectedVersion: 2 },
        ],
      },
    ])
      expect((await batch("reorder", body)).statusCode).toBe(409);
    expect((await batch("reorder", orderBody([a, a]))).statusCode).toBe(400);
    expect(
      (
        await batch("reorder", {
          ...orderBody([a, b]),
          items: [
            { id: a.id, expectedVersion: 1 },
            { id: a.id.toUpperCase(), expectedVersion: 1 },
          ],
        })
      ).statusCode,
    ).toBe(400);
    expect((await read(`${base()}/${a.id}`)).json()).toEqual(a);
    expect((await read(`${base()}/${b.id}`)).json()).toEqual(b);
    expect(
      await db
        .select()
        .from(writeReceipts)
        .where(inArray(writeReceipts.ledgerId, fixtureLedgers)),
    ).toHaveLength(4);
  });
  it("reorders child groups and excludes archives from the required sibling set", async () => {
    const root = await saved();
    const a = await saved(input("A", "expense", root.id));
    const b = await saved(input("B", "expense", root.id));
    const old = await saved(input("Old", "expense", root.id));
    await archive(old.id);
    expect(
      (await batch("reorder", orderBody([b, a], "expense", root.id)))
        .statusCode,
    ).toBe(200);
    expect(
      (await batch("reorder", orderBody([old, a, b], "expense", root.id)))
        .statusCode,
    ).toBe(409);
  });
  it("resolves simultaneous reorder/edit conflicts without overwriting changes", async () => {
    const a = await saved(input("A"));
    const b = await saved(input("B"));
    const responses = await Promise.all([
      batch("reorder", orderBody([b, a])),
      edit(a.id, { name: "Edited", expectedVersion: 1 }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);
  });
  it("creates the starter set only explicitly, atomically, with replay and empty-ledger checks", async () => {
    expect((await read(base())).json().items).toEqual([]);
    expect((await batch("starter-set", {})).statusCode).toBe(400);
    const key = newId();
    const responses = await Promise.all([
      batch("starter-set", { starterSet: "basic" }, ledgerId, ownerCookie, key),
      batch("starter-set", { starterSet: "basic" }, ledgerId, ownerCookie, key),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([
      201, 201,
    ]);
    expect(responses[0]?.json()).toEqual(responses[1]?.json());
    expect(responses[0]?.json().items).toHaveLength(7);
    expect(
      (await batch("starter-set", { starterSet: "basic" })).statusCode,
    ).toBe(409);
    for (const row of categoryListSchema.parse((await read(base())).json())
      .items)
      await archive(row.id);
    expect(
      (await batch("starter-set", { starterSet: "basic" })).statusCode,
    ).toBe(409);
    expect((await read(base())).json().items).toHaveLength(7);
  });
  it("creates the default starter set in two levels, only the chosen groups, once", async () => {
    expect(
      (
        await batch("starter-set", {
          starterSet: "default",
          groups: ["salary", "salary"],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await batch("starter-set", { starterSet: "basic", groups: ["salary"] }))
        .statusCode,
    ).toBe(400);
    const key = newId();
    const body = { starterSet: "default", groups: ["salary", "housing"] };
    const responses = await Promise.all([
      batch("starter-set", body, ledgerId, ownerCookie, key),
      batch("starter-set", body, ledgerId, ownerCookie, key),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([
      201, 201,
    ]);
    expect(responses[0]?.json()).toEqual(responses[1]?.json());
    const items = categoryListSchema.parse((await read(base())).json()).items;
    expect(items).toHaveLength(4 + 4);
    const salary = items.find((row) => row.name === "Salary & wages");
    const housing = items.find((row) => row.name === "Housing");
    expect(salary?.kind).toBe("income");
    expect(
      items.filter((row) => row.parentId === salary?.id).map((row) => row.name),
    ).toEqual(["Salary", "Hourly wages", "Bonus"]);
    expect(
      items
        .filter((row) => row.parentId === housing?.id)
        .map((row) => [row.name, row.kind, row.sortOrder]),
    ).toEqual([
      ["Rent or mortgage", "expense", 0],
      ["Home maintenance", "expense", 1],
      ["Home insurance", "expense", 2],
    ]);
    // A second run is refused, and no account is ever created by a starter.
    expect(
      (await batch("starter-set", { starterSet: "default" })).statusCode,
    ).toBe(409);
    expect((await read(base())).json().items).toHaveLength(8);
  });
  it("creates every default group but no add-on unless one is named", async () => {
    const response = await batch("starter-set", { starterSet: "default" });
    expect(response.statusCode).toBe(201);
    expect(response.json().items).toHaveLength(37);
    expect(
      response
        .json()
        .items.some((row: { name: string }) => row.name === "Student costs"),
    ).toBe(false);
    expect(
      (await batch("starter-set", { starterSet: "personal" }, secondLedger))
        .statusCode,
    ).toBe(201);
    expect((await read(base())).json().items).toHaveLength(37);
  });
  it("creates an add-on only when explicitly chosen", async () => {
    const response = await batch("starter-set", {
      starterSet: "default",
      groups: ["students"],
    });
    expect(response.statusCode).toBe(201);
    expect(
      response.json().items.map((row: { name: string }) => row.name),
    ).toEqual(["Student costs", "Tuition & fees", "Books & supplies"]);
  });
  it("paginates in stable ID order and filters by kind/status", async () => {
    const rows = [];
    for (let i = 0; i < 5; i++) rows.push(await saved(input(`Category ${i}`)));
    await saved(input("Income", "income"));
    const old = rows[2];
    if (!old) throw new Error("Missing row");
    await archive(old.id);
    const ids = [];
    let cursor: string | null = null;
    do {
      const page = categoryListSchema.parse(
        (
          await read(
            `${base()}?kind=expense&limit=2${cursor ? `&cursor=${cursor}` : ""}`,
          )
        ).json(),
      );
      ids.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toEqual(rows.map((row) => row.id).sort());
    expect(
      (await read(`${base()}?kind=expense&status=active`)).json().items,
    ).toHaveLength(4);
    expect((await read(`${base()}?kind=income`)).json().items).toHaveLength(1);
  });
  it("hides tombstones in lists, details, parents and every target mutation", async () => {
    const row = await saved();
    await db
      .update(categories)
      .set({ deletedAt: new Date() })
      .where(and(fixtureScope, eq(categories.id, row.id)));
    expect((await read(base())).json().items).toEqual([]);
    expect((await read(`${base()}/${row.id}`)).statusCode).toBe(404);
    expect((await edit(row.id)).statusCode).toBe(404);
    expect((await archive(row.id)).statusCode).toBe(404);
    expect((await unarchive(row.id)).statusCode).toBe(404);
    expect((await create(input("Child", "expense", row.id))).statusCode).toBe(
      404,
    );
    expect((await batch("reorder", orderBody([row]))).statusCode).toBe(404);
  });
  it("rechecks membership and ledger tombstones before every endpoint and receipt replay", async () => {
    const key = newId();
    const row = categorySchema.parse(
      (await create(input(), ledgerId, ownerCookie, key)).json(),
    );
    for (const table of ["membership", "ledger"]) {
      if (table === "membership")
        await db
          .update(ledgerMembers)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(ledgerMembers.userId, ownerId),
              eq(ledgerMembers.ledgerId, ledgerId),
            ),
          );
      else
        await db
          .update(ledgers)
          .set({ deletedAt: new Date() })
          .where(eq(ledgers.id, ledgerId));
      for (const response of [
        await read(base()),
        await read(`${base()}/${row.id}`),
        ...(await mutations(row)),
        await create(input(), ledgerId, ownerCookie, key),
      ])
        expect(response.statusCode).toBe(404);
      await db
        .update(ledgerMembers)
        .set({ deletedAt: null })
        .where(
          and(
            eq(ledgerMembers.userId, ownerId),
            eq(ledgerMembers.ledgerId, ledgerId),
          ),
        );
      await db
        .update(ledgers)
        .set({ deletedAt: null })
        .where(eq(ledgers.id, ledgerId));
    }
    await db
      .update(ledgerMembers)
      .set({ role: "viewer" })
      .where(
        and(
          eq(ledgerMembers.userId, ownerId),
          eq(ledgerMembers.ledgerId, ledgerId),
        ),
      );
    expect((await create(input(), ledgerId, ownerCookie, key)).statusCode).toBe(
      403,
    );
  });
  it("requires write keys and trusted origins on all six mutations", async () => {
    const row = await saved();
    const requests = [
      { method: "POST" as const, url: base(), payload: input("New") },
      {
        method: "PATCH" as const,
        url: `${base()}/${row.id}`,
        payload: { name: "Edit", expectedVersion: 1 },
      },
      {
        method: "POST" as const,
        url: `${base()}/${row.id}/archive`,
        payload: { expectedVersion: 1 },
      },
      {
        method: "POST" as const,
        url: `${base()}/${row.id}/unarchive`,
        payload: { expectedVersion: 1 },
      },
      {
        method: "POST" as const,
        url: `${base()}/reorder`,
        payload: orderBody([row]),
      },
      {
        method: "POST" as const,
        url: `${base()}/starter-set`,
        payload: { starterSet: "basic" },
      },
    ];
    for (const request of requests) {
      expect(
        (
          await app.inject({
            ...request,
            headers: { cookie: ownerCookie, origin: config.APP_URL },
          })
        ).statusCode,
      ).toBe(400);
      for (const origin of [undefined, "https://evil.example"])
        expect(
          (
            await app.inject({
              ...request,
              headers: {
                cookie: ownerCookie,
                "idempotency-key": newId(),
                ...(origin ? { origin } : {}),
              },
            })
          ).statusCode,
        ).toBe(403);
    }
  });
  it("enforces scoped parent and sibling-name constraints in PostgreSQL too", async () => {
    const root = await saved();
    const other = await saved(input("Foreign parent"), secondLedger);
    const income = await saved(input("Income", "income"));
    for (const parent of [other, income]) {
      await expect(
        db.insert(categories).values({
          ledgerId,
          name: "Invalid child",
          kind: "expense",
          parentId: parent.id,
        }),
      ).rejects.toThrow();
    }
    await expect(
      db
        .insert(categories)
        .values({ ledgerId, name: " fOoD ", kind: "expense" }),
    ).rejects.toThrow();
    await expect(
      db
        .update(categories)
        .set({ parentId: root.id })
        .where(and(fixtureScope, eq(categories.id, root.id))),
    ).rejects.toThrow();
    expect((await read(`${base()}/${root.id}`)).json()).toEqual(root);
  });
  it("rolls back earlier reorder updates and the receipt when a later database write fails", async () => {
    const a = await saved(input("A"));
    const b = await saved(input("B"));
    // Dedicated test DB only; this fault applies solely to this synthetic ledger/row.
    await db.execute(
      sql`CREATE FUNCTION categories_test_fail_reorder() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.ledger_id = '${sql.raw(ledgerId)}'::uuid AND NEW.id = '${sql.raw(a.id)}'::uuid THEN RAISE EXCEPTION 'synthetic batch failure'; END IF; RETURN NEW; END $$`,
    );
    try {
      await db.execute(
        sql`CREATE TRIGGER categories_test_fail_reorder BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION categories_test_fail_reorder()`,
      );
      const key = newId();
      const body = orderBody([b, a]);
      const failed = await batch("reorder", body, ledgerId, ownerCookie, key);
      expect(failed.statusCode).toBe(500);
      expect(failed.json().detail).toBe("Please try again later.");
      expect((await read(`${base()}/${a.id}`)).json()).toEqual(a);
      expect((await read(`${base()}/${b.id}`)).json()).toEqual(b);
      expect(
        await db
          .select()
          .from(writeReceipts)
          .where(
            and(
              eq(writeReceipts.ledgerId, ledgerId),
              eq(writeReceipts.key, key),
            ),
          ),
      ).toHaveLength(0);
      await db.execute(
        sql`DROP TRIGGER categories_test_fail_reorder ON categories`,
      );
      expect(
        (await batch("reorder", body, ledgerId, ownerCookie, key)).statusCode,
      ).toBe(200);
    } finally {
      await db.execute(
        sql`DROP TRIGGER IF EXISTS categories_test_fail_reorder ON categories`,
      );
      await db.execute(sql`DROP FUNCTION categories_test_fail_reorder()`);
    }
  });
  it("rolls back a partly inserted starter set and permits retry with the original key", async () => {
    await db.execute(
      sql`CREATE FUNCTION categories_test_fail_starter() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.ledger_id = '${sql.raw(ledgerId)}'::uuid AND NEW.name = 'Housing' THEN RAISE EXCEPTION 'synthetic batch failure'; END IF; RETURN NEW; END $$`,
    );
    try {
      await db.execute(
        sql`CREATE TRIGGER categories_test_fail_starter BEFORE INSERT ON categories FOR EACH ROW EXECUTE FUNCTION categories_test_fail_starter()`,
      );
      const key = newId();
      expect(
        (
          await batch(
            "starter-set",
            { starterSet: "basic" },
            ledgerId,
            ownerCookie,
            key,
          )
        ).statusCode,
      ).toBe(500);
      expect((await read(base())).json().items).toEqual([]);
      expect(
        await db
          .select()
          .from(writeReceipts)
          .where(eq(writeReceipts.ledgerId, ledgerId)),
      ).toHaveLength(0);
      await db.execute(
        sql`DROP TRIGGER categories_test_fail_starter ON categories`,
      );
      expect(
        (
          await batch(
            "starter-set",
            { starterSet: "basic" },
            ledgerId,
            ownerCookie,
            key,
          )
        ).statusCode,
      ).toBe(201);
    } finally {
      await db.execute(
        sql`DROP TRIGGER IF EXISTS categories_test_fail_starter ON categories`,
      );
      await db.execute(sql`DROP FUNCTION categories_test_fail_starter()`);
    }
  });
  it("documents every endpoint with session, key, version and safe problem contracts", async () => {
    const doc = (await app.inject({ url: "/api/v1/openapi.json" })).json();
    expect(doc.info.version).toBe("0.1.20");
    const prefix = "/api/v1/ledgers/{ledgerId}/categories";
    for (const [path, method] of [
      [prefix, "get"],
      [prefix, "post"],
      [`${prefix}/{categoryId}`, "get"],
      [`${prefix}/{categoryId}`, "patch"],
      [`${prefix}/{categoryId}/archive`, "post"],
      [`${prefix}/{categoryId}/unarchive`, "post"],
      [`${prefix}/reorder`, "post"],
      [`${prefix}/starter-set`, "post"],
    ]) {
      const operation = doc.paths[path as string][method as string];
      expect(operation.security).toEqual([{ sessionCookie: [] }]);
      expect(operation.responses["404"]).toBeDefined();
      if (method !== "get") {
        expect(operation.parameters).toContainEqual(
          expect.objectContaining({
            name: "idempotency-key",
            in: "header",
            required: true,
          }),
        );
        expect(operation.responses["409"]).toBeDefined();
      }
    }
  });
});
