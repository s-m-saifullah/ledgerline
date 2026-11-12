import { afterEach, describe, expect, it, vi } from "vitest";
import { requireTestDatabase } from "../test-support/harness";
import { createDatabase, type DatabaseOptions } from "./client";

// API-wide rule: a database that restarts, drops a connection or stalls must cost the requests that were using it,
// never the whole process, and a stuck query or a stuck waiter must not hold a connection for ever.
const url = requireTestDatabase("Database client tests");
const open: Array<{ end: () => Promise<void> }> = [];
const quiet = () => {};

function database(options?: DatabaseOptions) {
  const made = createDatabase(url, options);
  open.push(made.pool);
  return made;
}

/** What a restart or a network cut does to a connection: the server ends it. */
async function terminateWhere(condition: string) {
  const { pool } = database({ onError: quiet });
  const ended = await pool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND ${condition}`,
  );
  return ended.rowCount ?? 0;
}

afterEach(async () => {
  await Promise.allSettled(open.splice(0).map((pool) => pool.end()));
  vi.restoreAllMocks();
});

describe("a database that drops a connection", () => {
  it("is reported once and is not fatal when the connection was idle; the next query gets a new one", async () => {
    const errors: Array<{ code?: string }> = [];
    const { pool } = database({
      onError: (error) => errors.push(error as never),
    });
    const first = await pool.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    const pid = first.rows[0]?.pid as number;
    expect(await terminateWhere(`pid = ${pid}`)).toBe(1);

    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("57P01");
    const again = await pool.query<{ one: number }>("SELECT 1 AS one");
    expect(again.rows[0]?.one).toBe(1);
  });

  it("is not fatal when the connection was in the middle of a request: that request fails, the process lives on", async () => {
    const errors: Array<{ code?: string }> = [];
    const { pool } = database({
      onError: (error) => errors.push(error as never),
    });
    const running = pool.query("SELECT pg_sleep(10) /* in-flight */").then(
      () => "finished" as const,
      (error: unknown) => error as { code?: string },
    );
    await vi.waitFor(async () =>
      expect(
        await terminateWhere(
          "query LIKE 'SELECT pg_sleep(10) /* in-flight */%'",
        ),
      ).toBe(1),
    );

    const outcome = await running;
    expect(outcome).not.toBe("finished");
    expect((outcome as { code?: string }).code).toBe("57P01");
    const again = await pool.query<{ one: number }>("SELECT 1 AS one");
    expect(again.rows[0]?.one).toBe(1);
  });

  it("writes one safe line when nobody asked to hear about it: the error class and code, never the message", async () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const { pool } = database();
    const first = await pool.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    await terminateWhere(`pid = ${first.rows[0]?.pid}`);

    const ours = () =>
      write.mock.calls
        .map(([text]) => String(text))
        .filter((text) => text.includes("Database connection error"));
    await vi.waitFor(() => expect(ours()).toHaveLength(1));
    const line = JSON.parse(ours()[0] as string);
    expect(line).toMatchObject({
      level: "error",
      msg: "Database connection error",
      pgCode: "57P01",
    });
    expect(Object.keys(line)).not.toContain("message");
    expect(JSON.stringify(line)).not.toContain("administrator command");
  });
});

describe("limits", () => {
  it("cancels a statement that runs past the limit", async () => {
    const { pool } = database({ statementTimeoutMillis: 300 });
    await expect(pool.query("SELECT pg_sleep(3)")).rejects.toMatchObject({
      code: "57014",
    });
    const again = await pool.query<{ one: number }>("SELECT 1 AS one");
    expect(again.rows[0]?.one).toBe(1);
  });

  it("ends a transaction that sits idle past the limit without crashing; the next query gets a new connection", async () => {
    const errors: Array<{ code?: string }> = [];
    const { pool } = database({
      idleInTransactionMillis: 300,
      onError: (error) => errors.push(error as never),
    });
    // A checked-out connection has no error listener of the pool's own: this is the case that used to crash the process.
    const client = await pool.connect();
    await client.query("BEGIN");

    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0), {
      timeout: 5000,
    });
    expect(errors[0]?.code).toBe("25P03");
    await expect(client.query("SELECT 1")).rejects.toThrow();
    client.release(true);
    const again = await pool.query<{ one: number }>("SELECT 1 AS one");
    expect(again.rows[0]?.one).toBe(1);
  });

  it("stops waiting for a free connection after the connect limit", async () => {
    const { pool } = database({
      max: 1,
      connectionTimeoutMillis: 300,
      onError: quiet,
    });
    const held = await pool.connect();
    await expect(pool.query("SELECT 1")).rejects.toThrow(/timeout/i);
    held.release();
  });

  it("starts from a minute for a statement, two minutes idle in a transaction and five seconds to connect", async () => {
    const { pool } = database();
    const shown = async (name: string) =>
      (await pool.query<Record<string, string>>(`SHOW ${name}`)).rows[0]?.[
        name
      ];
    expect(await shown("statement_timeout")).toBe("1min");
    expect(await shown("idle_in_transaction_session_timeout")).toBe("2min");
    expect(pool.options.connectionTimeoutMillis).toBe(5000);
    expect(pool.options.max).toBe(10);
  });

  it("takes 0 to mean no limit", async () => {
    const { pool } = database({
      statementTimeoutMillis: 0,
      idleInTransactionMillis: 0,
    });
    const shown = async (name: string) =>
      (await pool.query<Record<string, string>>(`SHOW ${name}`)).rows[0]?.[
        name
      ];
    expect(await shown("statement_timeout")).toBe("0");
    expect(await shown("idle_in_transaction_session_timeout")).toBe("0");
  });
});
