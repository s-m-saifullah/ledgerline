import { z } from "zod";
import { ApiProblem } from "../../lib/problem";
import type { SyncPosition } from "../../lib/sync-keyset";

/** The tables the pull sends, in the order they are read. */
export const syncTables = [
  "accounts",
  "categories",
  "tags",
  "currencies",
  "exchangeRates",
  "transactions",
  "transactionSplits",
  "transactionTags",
] as const;
export type SyncTable = (typeof syncTables)[number];
export type SyncPositions = Partial<Record<SyncTable, SyncPosition>>;

const position = z.strictObject({
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  id: z.uuid(),
});
const cursorSchema = z.strictObject({
  v: z.literal(1),
  p: z.strictObject(
    Object.fromEntries(syncTables.map((name) => [name, position.optional()])),
  ),
});

/** Where each table's pull stands, as an opaque text the app sends back. */
export function encodeCursor(positions: SyncPositions) {
  return Buffer.from(JSON.stringify({ v: 1, p: positions })).toString(
    "base64url",
  );
}

/** Reads a cursor the server made; anything else is a 400. No cursor means start from the beginning. */
export function decodeCursor(text: string | undefined): SyncPositions {
  if (!text) return {};
  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(Buffer.from(text, "base64url").toString("utf8")),
    );
    if (parsed.success) return parsed.data.p as SyncPositions;
  } catch {
    // Falls through to the problem below.
  }
  throw new ApiProblem(400, "Invalid request", "The cursor is not valid.", [
    { field: "cursor", message: "Use the cursor from the last response." },
  ]);
}
