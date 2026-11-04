import { managedUserSchema, newId } from "@ledgerline/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { createDatabase } from "../../db/client";
import { applyMigrations } from "../../db/migrate";
import { ledgerMembers, ledgers, user } from "../../db/schema";
import { requireTestDatabase, testConfig } from "../../test-support/harness";
import {
  day,
  ledgerFixture,
  month,
  type Person,
} from "../../test-support/ledger-fixture";
import { createAccount } from "../auth/accounts";

// ADR 0048: two people on one server cannot see or change each other's data, and the admin never sees anyone's
// money. Proved, not assumed: every documented ledger route is called by each person against each other person's
// ledger, with that ledger's own real ids, and the other ledger must come out byte-for-byte unchanged.
const url = requireTestDatabase("Isolation tests");
const config = testConfig(url, "iso");
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
await app.ready();
const mailbox = (name: string) => `iso-${name}@example.com`;
const temporary = "temporary-pass-1234";
const own = "my-own-password-5678";

const { signIn, send, seed, fingerprint, wipe } = ledgerFixture({
  app,
  config,
  db,
  mailbox,
  emailLike: "iso-%@example.com",
});
const people = {} as Record<"admin" | "ann" | "bob", Person>;
const order = ["admin", "ann", "bob"] as const;

const row = async (id: string) =>
  (
    await db.select().from(user).where(eq(user.id, id))
  )[0] as typeof user.$inferSelect;

// ---- walking the documented routes ------------------------------------------------------------------------------

type Schema = Record<string, unknown>;
type Operation = {
  parameters?: {
    name: string;
    in: string;
    required?: boolean;
    schema: Schema;
  }[];
  requestBody?: { content: Record<string, { schema: Schema }> };
};
type Document = {
  paths: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, Schema> };
};
const document = () => app.swagger() as unknown as Document;

/** The smallest value a JSON schema accepts, with the person's real ids where a name asks for one. */
function sample(
  schema: Schema,
  name: string,
  ids: Record<string, string>,
  components: Record<string, Schema>,
): unknown {
  const ref = schema.$ref as string | undefined;
  if (ref)
    return sample(
      components[ref.split("/").pop() as string] as Schema,
      name,
      ids,
      components,
    );
  const options = (schema.anyOf ?? schema.oneOf) as Schema[] | undefined;
  if (options) {
    // The transfer-only fields of an expense rule are sent as null; every other choice takes the first form.
    const empty = options.find((option) => option.type === "null");
    return empty && ["toAccountId", "receivedAmount", "bonus"].includes(name)
      ? null
      : sample(options[0] as Schema, name, ids, components);
  }
  if ("const" in schema) return schema.const;
  if (schema.enum) return (schema.enum as unknown[])[0];
  switch (schema.type) {
    case "object": {
      const out: Record<string, unknown> = {};
      const properties = (schema.properties ?? {}) as Record<string, Schema>;
      for (const key of (schema.required ?? []) as string[])
        out[key] = sample(properties[key] ?? {}, key, ids, components);
      return out;
    }
    case "array": {
      const min = (schema.minItems as number | undefined) ?? 0;
      const item = schema.items as Schema | undefined;
      if (!min || !item) return [];
      return Array.from({ length: min }, () =>
        sample(item, name, ids, components),
      );
    }
    case "integer":
    case "number":
      return Math.max((schema.minimum as number | undefined) ?? 0, 1);
    case "boolean":
      return false;
    case "string": {
      if (name in ids) return ids[name];
      if (name === "timeZone") return "UTC";
      if (name === "previewToken") return "a".repeat(64);
      if (name === "fromMonth") return "2026-10";
      if (String(schema.pattern ?? "").includes("\\d{4}-(?:0[1-9]"))
        return month;
      if (/month/i.test(name)) return month;
      if (/^code$|currency/i.test(name)) return "EUR";
      if (/^time$/i.test(name)) return "09:30";
      if (name === "rate" || name === "fxRate") return "1.25";
      if (schema.format === "uuid") return newId();
      if (schema.format === "date") return day;
      if (schema.format === "date-time") return "2026-11-02T10:00:00.000Z";
      if (schema.format === "email") return "someone@example.com";
      return "x".repeat((schema.minLength as number | undefined) ?? 1);
    }
    default:
      return null;
  }
}

type Call = {
  method: string;
  template: string;
  url: (ledgerId: string, ids: Record<string, string>) => string;
  body: (ids: Record<string, string>) => unknown;
};
/** Every documented route under a ledger, ready to be called against any ledger with that ledger's own ids. */
function ledgerCalls(): Call[] {
  const doc = document();
  const components = doc.components?.schemas ?? {};
  const calls: Call[] = [];
  for (const [template, operations] of Object.entries(doc.paths)) {
    if (!template.startsWith("/api/v1/ledgers/{ledgerId}")) continue;
    for (const [method, operation] of Object.entries(operations)) {
      const parameters = operation.parameters ?? [];
      const schema = operation.requestBody?.content["application/json"]?.schema;
      calls.push({
        method: method.toUpperCase(),
        template: `${method.toUpperCase()} ${template}`,
        url: (ledgerId, ids) => {
          let path = template.replace("{ledgerId}", ledgerId);
          for (const parameter of parameters.filter((p) => p.in === "path"))
            path = path.replace(
              `{${parameter.name}}`,
              String(
                parameter.name in ids
                  ? ids[parameter.name]
                  : sample(parameter.schema, parameter.name, ids, components),
              ),
            );
          const query = parameters
            .filter((p) => p.in === "query" && p.required)
            .map(
              (p) =>
                `${p.name}=${encodeURIComponent(String(sample(p.schema, p.name, ids, components)))}`,
            );
          return query.length ? `${path}?${query.join("&")}` : path;
        },
        body: (ids) => {
          const body = schema ? sample(schema, "", ids, components) : undefined;
          // Rules a JSON schema cannot say: an expense is a negative amount.
          const amount = (body as { amount?: { amount: number } } | undefined)
            ?.amount;
          if (amount && /transactions|recurring-rules/.test(template))
            amount.amount = -1;
          // A change must change something: these routes refuse a body with only the version.
          const change = body as Record<string, unknown> | undefined;
          if (change && method === "patch") {
            if (/\/(accounts|categories)\/\{/.test(template)) change.name = "x";
            if (/\/transactions\/\{/.test(template)) change.note = "x";
          }
          return body;
        },
      });
    }
  }
  return calls;
}
const calls = ledgerCalls();
const reads = calls.filter((call) => call.method === "GET");
const writes = calls.filter((call) => call.method !== "GET");

/** The answer to one call as one person against one ledger. */
async function attempt(
  call: Call,
  by: Person,
  against: Person,
  ledgerId = against.ledgerId,
) {
  return send(
    call.method,
    call.url(ledgerId, against.ids),
    by.cookie,
    call.body(against.ids),
  );
}

beforeAll(async () => {
  await applyMigrations(url);
  await wipe();
  await app.ready();
  const made = await db.transaction((tx) =>
    createAccount(tx, {
      email: mailbox("admin"),
      name: "admin",
      password: own,
      isAdmin: true,
    }),
  );
  const adminCookie = await signIn(mailbox("admin"), own);
  people.admin = {
    name: "admin",
    id: made.userId,
    ledgerId: made.ledgerId,
    cookie: adminCookie,
    marker: "IsoMarkeradmin",
    ids: {},
    secrets: [],
  };
  // The other two are added by the admin through the real route and choose their own password, like real people.
  for (const name of ["ann", "bob"] as const) {
    const added = await send("POST", "/api/v1/users", adminCookie, {
      name: `Person ${name}`,
      email: mailbox(name),
      temporaryPassword: temporary,
    });
    expect(added.statusCode, added.body).toBe(201);
    const created = managedUserSchema.parse(added.json());
    const first = await signIn(mailbox(name), temporary);
    const changed = await send("POST", "/api/v1/me/password", first, {
      currentPassword: temporary,
      newPassword: own,
    });
    expect(changed.statusCode, changed.body).toBe(204);
    const [member] = await db
      .select({ ledgerId: ledgerMembers.ledgerId })
      .from(ledgerMembers)
      .where(eq(ledgerMembers.userId, created.id));
    people[name] = {
      name,
      id: created.id,
      ledgerId: member?.ledgerId as string,
      cookie: first,
      marker: `IsoMarker${name}`,
      ids: {},
      secrets: [],
    };
  }
  for (const name of order) await seed(people[name]);
}, 120000);
afterAll(async () => {
  await wipe();
  await app.close();
  await pool.end();
});

describe("the walk covers the whole API, so the proofs below mean something", () => {
  it("finds every kind of ledger route, and the seed reaches every id a route names", () => {
    expect(reads.length).toBeGreaterThan(30);
    expect(writes.length).toBeGreaterThan(40);
    const pathParams = new Set<string>();
    for (const [template, operations] of Object.entries(document().paths))
      if (template.startsWith("/api/v1/ledgers/{ledgerId}"))
        for (const operation of Object.values(operations))
          for (const parameter of operation.parameters ?? [])
            if (parameter.in === "path") pathParams.add(parameter.name);
    pathParams.delete("ledgerId");
    // The ones the seed cannot make (an occurrence needs the job runner; `action` is an enum) are named here.
    const known = new Set([
      ...Object.keys(people.ann?.ids ?? {}),
      "runId",
      "action",
    ]);
    expect([...pathParams].filter((name) => !known.has(name))).toEqual([]);
    for (const value of Object.values(people.ann?.ids ?? {}))
      expect(value).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("two people cannot reach each other's ledger", () => {
  const pairs = order.flatMap((by) =>
    order.filter((to) => to !== by).map((to) => [by, to] as const),
  );

  it.each(pairs)(
    "%s reading %s's ledger: every read is 404",
    async (by, to) => {
      const wrong: string[] = [];
      for (const call of reads) {
        const response = await attempt(call, people[by], people[to]);
        if (response.statusCode !== 404)
          wrong.push(`${call.template} -> ${response.statusCode}`);
        for (const secret of people[to].secrets)
          if (response.body.includes(secret))
            wrong.push(`${call.template} leaked ${secret}`);
      }
      expect(wrong).toEqual([]);
    },
    120000,
  );

  it.each(pairs)(
    "%s writing to %s's ledger: every write is 404 and the ledger is unchanged",
    async (by, to) => {
      const before = await fingerprint(people[to].ledgerId);
      const wrong: string[] = [];
      for (const call of writes) {
        const response = await attempt(call, people[by], people[to]);
        if (response.statusCode !== 404)
          wrong.push(
            `${call.template} -> ${response.statusCode} ${response.body.slice(0, 300)}`,
          );
      }
      expect(wrong).toEqual([]);
      expect(await fingerprint(people[to].ledgerId)).toEqual(before);
    },
    120000,
  );

  it("a ledger that does not exist answers the same way, so a 404 says nothing about who owns what", async () => {
    const nobody = newId();
    for (const call of [...reads, ...writes]) {
      const response = await attempt(
        call,
        people.ann as Person,
        people.ann as Person,
        nobody,
      );
      expect(response.statusCode, call.template).toBe(404);
    }
  }, 120000);
});

describe("what each person's own reads hold", () => {
  it.each(order)(
    "%s's own reads work and hold nothing of anyone else's",
    async (name) => {
      const me = people[name];
      const others = order
        .filter((other) => other !== name)
        .flatMap((other) => people[other].secrets);
      let answered = 0;
      for (const call of reads) {
        const response = await attempt(call, me, me);
        expect(
          response.statusCode,
          `${call.template}: ${response.body.slice(0, 200)}`,
        ).toBe(200);
        answered++;
        for (const secret of others)
          expect(
            response.body.includes(secret),
            `${call.template} holds ${secret}`,
          ).toBe(false);
      }
      expect(answered).toBe(reads.length);
      const list = (await send("GET", "/api/v1/ledgers", me.cookie)).json();
      expect(list.items.map((item: { id: string }) => item.id)).toEqual([
        me.ledgerId,
      ]);
    },
    120000,
  );

  it("holds the person's own data, so an empty answer is not mistaken for isolation", async () => {
    const ann = people.ann as Person;
    const accounts = await attempt(
      reads.find(
        (call) => call.template === "GET /api/v1/ledgers/{ledgerId}/accounts",
      ) as Call,
      ann,
      ann,
    );
    expect(accounts.body).toContain(ann.marker);
    const transactions = await attempt(
      reads.find(
        (call) =>
          call.template === "GET /api/v1/ledgers/{ledgerId}/transactions",
      ) as Call,
      ann,
      ann,
    );
    expect(transactions.body).toContain(ann.marker);
  });
});

describe("references across ledgers", () => {
  it("a person cannot point their own ledger at another person's rows", async () => {
    const ann = people.ann as Person;
    const bob = people.bob as Person;
    const before = await fingerprint(bob.ledgerId);
    const attempts: [string, string, unknown][] = [
      [
        "POST",
        "/transactions",
        {
          accountId: bob.ids.accountId,
          categoryId: ann.ids.categoryId,
          kind: "expense",
          date: day,
          amount: { amount: 100, currency: "USD" },
        },
      ],
      [
        "POST",
        "/transactions",
        {
          accountId: ann.ids.accountId,
          categoryId: bob.ids.categoryId,
          kind: "expense",
          date: day,
          amount: { amount: 100, currency: "USD" },
        },
      ],
      [
        "POST",
        "/transfers",
        {
          fromAccountId: ann.ids.accountId,
          toAccountId: bob.ids.accountId,
          amount: { amount: 100, currency: "USD" },
          date: day,
        },
      ],
      [
        "POST",
        "/receivables",
        {
          contactId: bob.ids.contactId,
          description: "x",
          serviceDate: day,
          amount: { amount: 100, currency: "USD" },
        },
      ],
      [
        "PUT",
        "/budgets",
        {
          categoryId: bob.ids.categoryId,
          month,
          amount: { amount: 100, currency: "USD" },
          rollover: false,
        },
      ],
    ];
    for (const [method, path, payload] of attempts) {
      const response = await send(
        method,
        `/api/v1/ledgers/${ann.ledgerId}${path}`,
        ann.cookie,
        payload,
      );
      expect(
        response.statusCode,
        `${method} ${path}: ${response.body}`,
      ).toBeGreaterThanOrEqual(400);
      expect(response.statusCode).toBeLessThan(500);
    }
    expect(await fingerprint(bob.ledgerId)).toEqual(before);
  });
});

describe("the admin never sees anyone's money", () => {
  it("the admin routes return no ledger data and no ledger id", async () => {
    const admin = people.admin as Person;
    const answers = [
      await send("GET", "/api/v1/users", admin.cookie),
      await send("GET", "/api/v1/users/deleted", admin.cookie),
      await send("GET", "/api/v1/me", admin.cookie),
      await send("GET", "/api/v1/ledgers", admin.cookie),
    ];
    for (const response of answers) {
      expect(response.statusCode).toBe(200);
      for (const name of ["ann", "bob"] as const)
        for (const secret of [
          people[name].ledgerId,
          people[name].marker,
          ...Object.values(people[name].ids),
        ])
          expect(response.body).not.toContain(secret);
    }
    // Every action on a person answers with account facts only.
    for (const name of ["ann", "bob"] as const) {
      const person = people[name];
      const stopped = await send(
        "PATCH",
        `/api/v1/users/${person.id}`,
        admin.cookie,
        { disabled: true },
      );
      const allowed = await send(
        "PATCH",
        `/api/v1/users/${person.id}`,
        admin.cookie,
        { disabled: false },
      );
      for (const response of [stopped, allowed])
        for (const secret of [
          person.ledgerId,
          person.marker,
          ...Object.values(person.ids),
        ])
          expect(response.body).not.toContain(secret);
      // Stopping a person ends their sessions, so they sign in again for the tests that follow.
      person.cookie = await signIn(mailbox(name), own);
    }
  });

  it("the admin is a member of no ledger but their own", async () => {
    const admin = people.admin as Person;
    const memberships = await db
      .select({ ledgerId: ledgerMembers.ledgerId })
      .from(ledgerMembers)
      .where(eq(ledgerMembers.userId, admin.id));
    expect(memberships.map((member) => member.ledgerId)).toEqual([
      admin.ledgerId,
    ]);
    for (const name of ["ann", "bob"] as const) {
      const members = await db
        .select({ userId: ledgerMembers.userId })
        .from(ledgerMembers)
        .where(eq(ledgerMembers.ledgerId, people[name].ledgerId));
      expect(members.map((member) => member.userId)).toEqual([people[name].id]);
    }
  });
});

describe("a person who is stopped or deleted", () => {
  it("keeps their ledger out of reach for everyone, and their own cookie stops working", async () => {
    const admin = people.admin as Person;
    const bob = people.bob as Person;
    const bobCookie = bob.cookie;
    expect(
      (
        await send("PATCH", `/api/v1/users/${bob.id}`, admin.cookie, {
          disabled: true,
        })
      ).statusCode,
    ).toBe(200);
    const stoppedRead = await attempt(reads[0] as Call, bob, bob);
    expect(stoppedRead.statusCode).toBe(401);
    expect(
      (await send("GET", `/api/v1/ledgers/${bob.ledgerId}/accounts`, bobCookie))
        .statusCode,
    ).toBe(401);
    expect(
      (await send("DELETE", `/api/v1/users/${bob.id}`, admin.cookie))
        .statusCode,
    ).toBe(204);
    expect((await row(bob.id)).deletedAt).not.toBeNull();
    // Recently deleted lists the person and holds nothing of their ledger (ADR 0049).
    const listed = await send("GET", "/api/v1/users/deleted", admin.cookie);
    expect(listed.body).toContain(bob.id);
    for (const secret of [bob.ledgerId, bob.marker, ...Object.values(bob.ids)])
      expect(listed.body).not.toContain(secret);
    for (const by of ["admin", "ann"] as const)
      for (const call of reads)
        expect(
          (await attempt(call, people[by], bob)).statusCode,
          `${by} ${call.template}`,
        ).toBe(404);
    for (const call of writes)
      expect(
        (await attempt(call, people.ann as Person, bob)).statusCode,
        call.template,
      ).toBe(404);
    // Ann is untouched by all of it.
    const mine = await send(
      "GET",
      `/api/v1/ledgers/${people.ann?.ledgerId}/accounts`,
      people.ann?.cookie as string,
    );
    expect(mine.statusCode).toBe(200);
    expect(
      await db
        .select()
        .from(ledgers)
        .where(and(eq(ledgers.id, people.ann?.ledgerId as string))),
    ).toHaveLength(1);
  }, 120000);
});
