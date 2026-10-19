import {
  createTransactionSchema,
  type ImportPreview,
  type ImportRow,
  maxTagsPerEntry,
  tagNameSchema,
} from "@ledgerline/shared";
import type { DatabaseConnection } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { lockTransactionAccounts } from "../accounts/service";
import { validateTransactionCategory } from "../categories/service";
import { existingTagKeys, tagKey } from "../tags/service";
import type { WriteContext } from "../writes/service";
import { priceEntry } from "./pricing";
import { transactionRepository } from "./repo";
import { checkBalances } from "./service";
import { attachImportedTags } from "./tag-service";

const signed = (row: ImportRow) =>
  row.kind === "expense" ? -row.amount : row.amount;

/** A row's tag names, trimmed and without repeats (ignoring case), or why they can't be used. */
function rowTags(row: ImportRow): { names: string[]; problem: string | null } {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const raw of row.tags) {
    const name = raw.trim();
    if (!name || seen.has(tagKey(name))) continue;
    if (!tagNameSchema.safeParse(name).success)
      return {
        names: [],
        problem:
          "A tag name must be 1 to 40 characters, without commas or semicolons.",
      };
    seen.add(tagKey(name));
    names.push(name);
  }
  return names.length > maxTagsPerEntry
    ? {
        names: [],
        problem: `An entry can have at most ${maxTagsPerEntry} tags.`,
      }
    : { names, problem: null };
}

/**
 * Which rows of a file already look like entries in the ledger: the same id (a file this app
 * exported), or the same date and amount in the same account. Each existing entry matches at
 * most one row, so two identical rows in a file are only both flagged when the ledger has two.
 */
export async function findImportDuplicates(
  db: DatabaseConnection,
  ledgerId: string,
  accountId: string,
  rows: ImportRow[],
) {
  const repo = transactionRepository(db, ledgerId);
  const dates = rows.map((row) => row.date).sort();
  const existing = await repo.importCandidates(
    accountId,
    dates[0] as string,
    dates.at(-1) as string,
  );
  const buckets = new Map<string, number>();
  for (const entry of existing) {
    const key = `${entry.date}|${entry.amount}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const known = new Set(
    await repo.existingIds(
      rows.flatMap((row) => (row.sourceId ? [row.sourceId.toLowerCase()] : [])),
    ),
  );
  const found = new Map<number, string>();
  for (const row of rows) {
    const key = `${row.date}|${signed(row)}`;
    const left = buckets.get(key) ?? 0;
    const sameId = !!row.sourceId && known.has(row.sourceId.toLowerCase());
    if (sameId || left > 0) {
      if (left > 0) buckets.set(key, left - 1);
      found.set(
        row.line,
        sameId
          ? "Already in your ledger (same entry id)."
          : "Same date and amount as an entry already in this account.",
      );
    }
  }
  return found;
}

/** Checks every row the way saving would, without saving: problems, duplicates, the rest ready. */
export async function previewImportRows(
  context: WriteContext,
  account: { id: string; currency: string },
  rows: ImportRow[],
): Promise<ImportPreview> {
  const problems = new Map<number, string>();
  const checkedCategories = new Map<string, string | null>();
  const checkedDates = new Map<string, string | null>();
  const reasonOf = async (check: () => Promise<unknown>) => {
    try {
      await check();
      return null;
    } catch (error) {
      if (error instanceof ApiProblem) return error.detail;
      throw error;
    }
  };
  for (const row of rows) {
    const categoryKey = `${row.categoryId}|${row.kind}`;
    if (!checkedCategories.has(categoryKey))
      checkedCategories.set(
        categoryKey,
        await reasonOf(() =>
          validateTransactionCategory(
            context.tx,
            context.ledgerId,
            row.categoryId,
            row.kind,
            true,
          ),
        ),
      );
    if (!checkedDates.has(row.date))
      checkedDates.set(
        row.date,
        await reasonOf(() =>
          priceEntry(context, {
            accountCurrency: account.currency,
            amount: { amount: 1, currency: account.currency },
            date: row.date,
          }),
        ),
      );
    const reason =
      checkedCategories.get(categoryKey) ??
      checkedDates.get(row.date) ??
      rowTags(row).problem;
    if (reason) problems.set(row.line, reason);
  }
  const duplicates = await findImportDuplicates(
    context.tx,
    context.ledgerId,
    account.id,
    rows,
  );
  const out = rows.map((row) => {
    const problem = problems.get(row.line);
    const duplicate = duplicates.get(row.line);
    return {
      line: row.line,
      state: problem
        ? ("problem" as const)
        : duplicate
          ? ("duplicate" as const)
          : ("ready" as const),
      reason: problem ?? duplicate ?? null,
    };
  });
  // Tag names no tag has yet (first spelling wins); confirming creates them.
  const wanted = new Map<string, string>();
  for (const row of rows)
    for (const name of rowTags(row).names)
      if (!wanted.has(tagKey(name))) wanted.set(tagKey(name), name);
  const known = await existingTagKeys(context.tx, context.ledgerId, [
    ...wanted.values(),
  ]);
  const newTags = [...wanted]
    .filter(([key]) => !known.has(key))
    .map(([, name]) => name);
  const count = (state: "ready" | "duplicate" | "problem") =>
    out.filter((row) => row.state === state).length;
  return {
    rows: out,
    counts: {
      ready: count("ready"),
      duplicate: count("duplicate"),
      problem: count("problem"),
    },
    newTags,
  };
}

/** Saves a whole import's entries inside a write that is already open; any bad row stops them all. */
export async function createImportedEntries(
  context: WriteContext,
  batchId: string,
  accountId: string,
  rows: ImportRow[],
) {
  const { tx, ledgerId } = context;
  const locked = await lockTransactionAccounts(tx, ledgerId, [accountId]);
  const account = locked[0];
  if (!account) throw new ApiProblem(404, "Not found", "Account not found.");
  if (account.archivedAt || account.contactId)
    throw new ApiProblem(409, "Conflict", "Choose an active account.", [
      { field: "accountId", message: "Choose an active account." },
    ]);
  const lineOf = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.categoryId}|${row.kind}`;
    if (!lineOf.has(key)) lineOf.set(key, row.line);
  }
  for (const [key, line] of lineOf) {
    const [categoryId, kind] = key.split("|") as [string, string];
    try {
      await validateTransactionCategory(tx, ledgerId, categoryId, kind, true);
    } catch (error) {
      if (error instanceof ApiProblem)
        throw new ApiProblem(
          error.statusCode,
          error.title,
          `Line ${line}: ${error.detail}`,
        );
      throw error;
    }
  }
  const repo = transactionRepository(tx, ledgerId);
  const tagged: { entryId: string; names: string[] }[] = [];
  for (const row of rows) {
    const amount = { amount: signed(row), currency: account.currency };
    try {
      const pricing = await priceEntry(context, {
        accountCurrency: account.currency,
        amount,
        date: row.date,
      });
      const tags = rowTags(row);
      if (tags.problem) throw new ApiProblem(409, "Conflict", tags.problem);
      const saved = await repo.create(
        createTransactionSchema.parse({
          accountId,
          categoryId: row.categoryId,
          kind: row.kind,
          date: row.date,
          time: row.time,
          amount,
          status: row.status,
          payee: row.payee,
          note: row.note,
        }),
        pricing,
        { importBatchId: batchId },
      );
      if (saved && tags.names.length)
        tagged.push({ entryId: saved.id, names: tags.names });
    } catch (error) {
      if (error instanceof ApiProblem)
        throw new ApiProblem(
          error.statusCode,
          error.title,
          `Line ${row.line}: ${error.detail}`,
          error.errors,
        );
      throw error;
    }
  }
  const tagsCreated = await attachImportedTags(tx, ledgerId, tagged);
  await checkBalances(context, locked);
  return { tagsCreated };
}

/** Deletes whatever is left of an import; entries already deleted stay as they are. */
export async function removeImportedEntries(
  context: WriteContext,
  batchId: string,
) {
  const { tx, ledgerId } = context;
  const repo = transactionRepository(tx, ledgerId);
  const accountIds = (await repo.importAccounts(batchId)).map(
    (row) => row.accountId,
  );
  const locked = accountIds.length
    ? await lockTransactionAccounts(tx, ledgerId, accountIds)
    : [];
  const removed = await repo.removeImported(batchId, new Date());
  if (locked.length) await checkBalances(context, locked);
  return removed.length;
}

/** How many entries each import still has in the ledger. */
export async function importRemainingCounts(
  db: DatabaseConnection,
  ledgerId: string,
  batchIds: string[],
) {
  const rows = await transactionRepository(db, ledgerId).importCounts(batchIds);
  return new Map(rows.map((row) => [row.batchId, Number(row.total)]));
}
