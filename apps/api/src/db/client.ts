import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { safeErrorFields } from "../lib/error-log";
import * as schema from "./schema";

export type DatabaseOptions = {
  /** Connections in the pool. */
  max?: number;
  /** How long a request waits for a free connection before it fails. */
  connectionTimeoutMillis?: number;
  /** The database cancels a statement that runs longer than this; 0 means no limit. */
  statementTimeoutMillis?: number;
  /** The database ends a connection that sits in an open transaction doing nothing for this long; 0 means no limit. */
  idleInTransactionMillis?: number;
  /** Told once about every connection that was lost. Defaults to one safe line on stderr. */
  onError?: (error: unknown) => void;
};

/** One JSON line with the error class and database code only: messages can echo amounts, payees and notes. */
function reportToStderr(error: unknown) {
  process.stderr.write(
    `${JSON.stringify({
      level: "error",
      time: new Date().toISOString(),
      msg: "Database connection error",
      ...safeErrorFields(error),
    })}\n`,
  );
}

/**
 * The connection pool and its database handle. A database that restarts or drops a connection (a deploy's backup,
 * a container restart, a network cut) makes `pg` emit `error` on the connection, and Node ends the process when
 * nothing listens. The pool listens for idle connections only, and takes its own listener off a connection while a
 * request uses it, so every connection gets a listener of its own as soon as it is made. The request that was using
 * the connection fails; the process, and every other request, carry on.
 *
 * The limits stop one stuck request from holding a connection for ever. Migrations pass 0 for both: a slow one
 * (building an index) must never be cut off at start-up.
 */
export function createDatabase(url: string, options: DatabaseOptions = {}) {
  const {
    max = 10,
    connectionTimeoutMillis = 5_000,
    statementTimeoutMillis = 60_000,
    idleInTransactionMillis = 120_000,
    onError = reportToStderr,
  } = options;
  const pool = new Pool({
    connectionString: url,
    max,
    connectionTimeoutMillis,
    statement_timeout: statementTimeoutMillis,
    idle_in_transaction_session_timeout: idleInTransactionMillis,
  });
  // An idle connection reports to its own listener and to the pool's: say it once.
  const told = new WeakSet<object>();
  const report = (error: unknown) => {
    if (typeof error === "object" && error !== null) {
      if (told.has(error)) return;
      told.add(error);
    }
    onError(error);
  };
  pool.on("connect", (client) => client.on("error", report));
  pool.on("error", report);
  const db = drizzle(pool, { schema });
  return { pool, db };
}
export type Database = ReturnType<typeof createDatabase>["db"];
export type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
export type DatabaseConnection = Database | DatabaseTransaction;
