import { and, asc, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { DatabaseConnection } from "../../db/client";
import { ledgers, recurringRules, recurringRuns } from "../../db/schema";

export type RuleRow = typeof recurringRules.$inferSelect;
export type RunRow = typeof recurringRuns.$inferSelect;
export type NewRule = Omit<
  typeof recurringRules.$inferInsert,
  "id" | "ledgerId" | "version" | "createdAt" | "updatedAt" | "deletedAt"
>;
type RuleChanges = Partial<NewRule>;

export function recurringRepository(db: DatabaseConnection, ledgerId: string) {
  const rules = and(
    eq(recurringRules.ledgerId, ledgerId),
    isNull(recurringRules.deletedAt),
  );
  const runs = and(
    eq(recurringRuns.ledgerId, ledgerId),
    isNull(recurringRuns.deletedAt),
  );
  return {
    list: () =>
      db
        .select()
        .from(recurringRules)
        .where(rules)
        .orderBy(asc(recurringRules.title), asc(recurringRules.id)),
    find: async (id: string) =>
      (
        await db
          .select()
          .from(recurringRules)
          .where(and(rules, eq(recurringRules.id, id)))
      )[0],
    /** Rules that still point at an account or category, so it cannot be deleted (ADR 0006). */
    /** Takes a tag off every rule that has it (the tag is being deleted); each rule's version moves on. */
    removeTag: (tagId: string) =>
      db
        .update(recurringRules)
        .set({
          tagIds: sql`array_remove(${recurringRules.tagIds}, ${tagId}::uuid)`,
          version: sql`${recurringRules.version} + 1`,
        })
        .where(and(rules, sql`${tagId}::uuid = any(${recurringRules.tagIds})`)),
    hasActiveReference: async (
      field: "accountId" | "categoryId",
      id: string,
    ) => {
      const match =
        field === "accountId"
          ? or(
              eq(recurringRules.accountId, id),
              eq(recurringRules.toAccountId, id),
            )
          : or(
              eq(recurringRules.categoryId, id),
              eq(recurringRules.bonusCategoryId, id),
              eq(recurringRules.feeCategoryId, id),
            );
      return (
        (
          await db
            .select({ id: recurringRules.id })
            .from(recurringRules)
            .where(and(rules, match))
            .limit(1)
        ).length > 0
      );
    },
    create: async (values: NewRule) =>
      (
        await db
          .insert(recurringRules)
          .values({ ...values, ledgerId })
          .returning()
      )[0],
    update: (
      id: string,
      expectedVersion: number,
      values: RuleChanges & { deletedAt?: Date },
      version: number,
    ) =>
      db
        .update(recurringRules)
        .set({ ...values, version })
        .where(
          and(
            rules,
            eq(recurringRules.id, id),
            eq(recurringRules.version, expectedVersion),
          ),
        )
        .returning(),
    attentionCounts: async () =>
      new Map(
        (
          await db
            .select({
              ruleId: recurringRuns.ruleId,
              count: sql<number>`count(*)::int`,
            })
            .from(recurringRuns)
            .where(and(runs, eq(recurringRuns.status, "attention")))
            .groupBy(recurringRuns.ruleId)
        ).map((row) => [row.ruleId, row.count]),
      ),
    runsOf: (ruleId: string, limit: number) =>
      db
        .select()
        .from(recurringRuns)
        .where(and(runs, eq(recurringRuns.ruleId, ruleId)))
        .orderBy(desc(recurringRuns.occurrenceDate))
        .limit(limit),
    hasRuns: async (ruleId: string) =>
      (
        await db
          .select({ id: recurringRuns.id })
          .from(recurringRuns)
          .where(and(runs, eq(recurringRuns.ruleId, ruleId)))
          .limit(1)
      ).length > 0,
    findRun: async (id: string) =>
      (
        await db
          .select()
          .from(recurringRuns)
          .where(and(runs, eq(recurringRuns.id, id)))
      )[0],
    findRunOn: async (ruleId: string, date: string) =>
      (
        await db
          .select()
          .from(recurringRuns)
          .where(
            and(
              runs,
              eq(recurringRuns.ruleId, ruleId),
              eq(recurringRuns.occurrenceDate, date),
            ),
          )
      )[0],
    /** One row per rule and date; a later outcome replaces an earlier one. */
    saveRun: async (values: {
      ruleId: string;
      occurrenceDate: string;
      status: "created" | "skipped" | "attention";
      reason: string | null;
      transactionId: string | null;
      transferId: string | null;
    }) =>
      (
        await db
          .insert(recurringRuns)
          .values({ ...values, ledgerId })
          .onConflictDoUpdate({
            target: [
              recurringRuns.ledgerId,
              recurringRuns.ruleId,
              recurringRuns.occurrenceDate,
            ],
            set: {
              status: values.status,
              reason: values.reason,
              transactionId: values.transactionId,
              transferId: values.transferId,
              version: sql`${recurringRuns.version} + 1`,
            },
          })
          .returning()
      )[0],
    skipRun: (id: string, expectedVersion: number, version: number) =>
      db
        .update(recurringRuns)
        .set({ status: "skipped", reason: null, version })
        .where(
          and(
            runs,
            eq(recurringRuns.id, id),
            eq(recurringRuns.version, expectedVersion),
            eq(recurringRuns.status, "attention"),
          ),
        )
        .returning(),
  };
}

/**
 * Background-job queries. These look across ledgers on purpose: the runner works for every ledger
 * and then acts as each rule's creator through the ordinary write path, which scopes and checks
 * access again.
 */
export async function activeRulesWithZone(
  db: DatabaseConnection,
  only?: { ledgerId?: string; ruleId?: string },
) {
  return db
    .select({ rule: recurringRules, timeZone: ledgers.timeZone })
    .from(recurringRules)
    .innerJoin(ledgers, eq(ledgers.id, recurringRules.ledgerId))
    .where(
      and(
        isNull(recurringRules.deletedAt),
        isNull(recurringRules.pausedAt),
        isNull(ledgers.deletedAt),
        isNotNull(recurringRules.nextDate),
        only?.ledgerId ? eq(recurringRules.ledgerId, only.ledgerId) : undefined,
        only?.ruleId ? eq(recurringRules.id, only.ruleId) : undefined,
      ),
    )
    .orderBy(asc(recurringRules.createdAt));
}
export async function attentionRuns(
  db: DatabaseConnection,
  only?: { ledgerId?: string; ruleId?: string },
) {
  return db
    .select({ run: recurringRuns, rule: recurringRules })
    .from(recurringRuns)
    .innerJoin(
      recurringRules,
      and(
        eq(recurringRules.ledgerId, recurringRuns.ledgerId),
        eq(recurringRules.id, recurringRuns.ruleId),
      ),
    )
    .where(
      and(
        isNull(recurringRuns.deletedAt),
        eq(recurringRuns.status, "attention"),
        isNull(recurringRules.deletedAt),
        isNull(recurringRules.pausedAt),
        only?.ledgerId ? eq(recurringRuns.ledgerId, only.ledgerId) : undefined,
        only?.ruleId ? eq(recurringRuns.ruleId, only.ruleId) : undefined,
      ),
    )
    .orderBy(asc(recurringRuns.occurrenceDate))
    .limit(100);
}
/** Move a rule's next date forward only if nobody changed it meanwhile (an edit wins). */
export async function advanceNextDate(
  db: DatabaseConnection,
  rule: Pick<RuleRow, "id" | "ledgerId">,
  from: string,
  to: string | null,
) {
  return (
    (
      await db
        .update(recurringRules)
        .set({ nextDate: to })
        .where(
          and(
            eq(recurringRules.ledgerId, rule.ledgerId),
            eq(recurringRules.id, rule.id),
            eq(recurringRules.nextDate, from),
            isNull(recurringRules.deletedAt),
            isNull(recurringRules.pausedAt),
          ),
        )
        .returning({ id: recurringRules.id })
    ).length === 1
  );
}
export function pauseForAccess(
  db: DatabaseConnection,
  rule: Pick<RuleRow, "id" | "ledgerId">,
) {
  return db
    .update(recurringRules)
    .set({
      pausedAt: new Date(),
      pausedReason: "access",
      version: sql`${recurringRules.version} + 1`,
    })
    .where(
      and(
        eq(recurringRules.ledgerId, rule.ledgerId),
        eq(recurringRules.id, rule.id),
        isNull(recurringRules.pausedAt),
      ),
    );
}
