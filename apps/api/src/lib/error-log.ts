/**
 * Fields that make a 500 diagnosable without leaking data. Postgres messages
 * and details can echo row values (amounts, payees, notes), so only the error
 * class, the SQLSTATE and the schema object names are kept.
 */
export function safeErrorFields(error: unknown) {
  const text = (value: unknown, pattern: RegExp) =>
    typeof value === "string" && pattern.test(value) ? value : undefined;
  const source = error instanceof Error ? error : undefined;
  // Drizzle wraps the driver error in `cause`.
  const driver =
    source?.cause && typeof source.cause === "object"
      ? (source.cause as Record<string, unknown>)
      : (source as unknown as Record<string, unknown> | undefined);
  return {
    errorName: text(source?.name, /^[A-Za-z0-9_]{1,80}$/),
    pgCode: text(driver?.code, /^[0-9A-Z]{5}$/),
    constraint: text(driver?.constraint, /^[A-Za-z0-9_]{1,128}$/),
    table: text(driver?.table, /^[A-Za-z0-9_]{1,128}$/),
  };
}
