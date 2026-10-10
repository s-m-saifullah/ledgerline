import {
  type Budget,
  type BudgetMonthView,
  budgetSchema,
  type CopyBudgets,
  computeBudgetPositions,
  type DeleteBudget,
  monthRange,
  type SetBudget,
} from "@ledgerline/shared";
import type { Database } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { expenseCategoryOverview } from "../categories/budget-service";
import { requireLedgerRead } from "../ledgers/service";
import { spendingByCategoryMonth } from "../transactions/budget-service";
import {
  runFinancialWrite,
  type WriteContext,
  type WriteIdentity,
  type WriteResponse,
} from "../writes/service";
import { nextVersion, requireVersionUpdate } from "../writes/version";
import { type BudgetRow, budgetRepository } from "./repo";

const usd = (amount: number | bigint) => ({
  amount: Number(amount),
  currency: "USD" as const,
});
export function budgetDto(row: BudgetRow): Budget {
  return budgetSchema.parse({
    id: row.id,
    ledgerId: row.ledgerId,
    categoryId: row.categoryId,
    month: row.month.slice(0, 7),
    amount: usd(row.amount),
    rollover: row.rollover,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
function conflict(field: string, message: string): never {
  throw new ApiProblem(409, "Conflict", message, [{ field, message }]);
}
function safeSum(values: bigint[]) {
  const total = values.reduce((sum, value) => sum + value, 0n);
  if (
    total > BigInt(Number.MAX_SAFE_INTEGER) ||
    total < BigInt(Number.MIN_SAFE_INTEGER)
  )
    throw new ApiProblem(
      409,
      "Conflict",
      "A budget total exceeds the supported exact money range.",
    );
  return Number(total);
}

/**
 * The month view: one line per top-level expense category with its budget, the leftover carried
 * in (computed, ADR 0019), this month's spending (subcategories included) and what is left.
 * One repeatable-read snapshot keeps budgets and spending consistent.
 */
export async function getBudgetMonth(
  db: Database,
  actorId: string,
  ledgerId: string,
  month: string,
): Promise<BudgetMonthView> {
  const range = monthRange(month);
  return db.transaction(
    async (tx) => {
      await requireLedgerRead(tx, actorId, ledgerId);
      const rows = await budgetRepository(tx, ledgerId).upTo(month);
      const tree = await expenseCategoryOverview(tx, ledgerId);
      const rootOf = new Map(
        tree.map((category) => [category.id, category.parentId ?? category.id]),
      );
      const earliest = rows.reduce(
        (first, row) => (row.month < first ? row.month : first),
        range.start,
      );
      const spending = await spendingByCategoryMonth(
        tx,
        ledgerId,
        earliest,
        range.end,
      );
      // Spending per root category and month; a split line counts for its own category.
      const spentBy = new Map<string, Map<string, bigint>>();
      for (const row of spending) {
        const root = rootOf.get(row.categoryId);
        if (!root) continue;
        const byMonth = spentBy.get(root) ?? new Map<string, bigint>();
        byMonth.set(row.month, (byMonth.get(row.month) ?? 0n) + row.spent);
        spentBy.set(root, byMonth);
      }
      const rowsByCategory = new Map<string, BudgetRow[]>();
      for (const row of rows) {
        rowsByCategory.set(row.categoryId, [
          ...(rowsByCategory.get(row.categoryId) ?? []),
          row,
        ]);
      }
      const lines = [];
      for (const category of tree
        .filter((item) => item.parentId === null)
        .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : 1))) {
        const own = rowsByCategory.get(category.id) ?? [];
        const byMonth = spentBy.get(category.id) ?? new Map<string, bigint>();
        const spentNumbers = new Map(
          [...byMonth].map(([key, value]) => [key, Number(value)]),
        );
        const positions = computeBudgetPositions(
          own.map((row) => ({
            month: row.month.slice(0, 7),
            amount: row.amount,
            rollover: row.rollover,
          })),
          spentNumbers,
        );
        const row = own.find((item) => item.month.slice(0, 7) === month);
        const position = positions.get(month);
        const spent = Number(byMonth.get(month) ?? 0n);
        if (!row && category.archived && spent === 0) continue;
        lines.push({
          categoryId: category.id,
          name: category.name,
          icon: category.icon,
          color: category.color,
          archived: category.archived,
          budget: row ? budgetDto(row) : null,
          carriedIn: usd(position?.carriedIn ?? 0),
          spent: usd(spent),
          left: position ? usd(position.left) : null,
        });
      }
      const budgeted = lines.filter((line) => line.budget);
      return {
        month,
        items: lines,
        totals: {
          budgeted: usd(
            safeSum(
              budgeted.map((line) => BigInt(line.budget?.amount.amount ?? 0)),
            ),
          ),
          carriedIn: usd(
            safeSum(budgeted.map((line) => BigInt(line.carriedIn.amount))),
          ),
          spent: usd(
            safeSum(budgeted.map((line) => BigInt(line.spent.amount))),
          ),
          left: usd(
            safeSum(budgeted.map((line) => BigInt(line.left?.amount ?? 0))),
          ),
          unbudgetedSpent: usd(
            safeSum(
              lines
                .filter((line) => !line.budget)
                .map((line) => BigInt(line.spent.amount)),
            ),
          ),
        },
      };
    },
    { isolationLevel: "repeatable read" },
  );
}

type Repo = ReturnType<typeof budgetRepository>;
function write(
  db: Database,
  identity: WriteIdentity,
  operation: string,
  request: Parameters<typeof runFinancialWrite>[1]["request"],
  mutate: (repo: Repo, context: WriteContext) => Promise<WriteResponse>,
) {
  return runFinancialWrite(
    db,
    { ...identity, operation, request },
    async (context) => {
      const repo = budgetRepository(context.tx, context.ledgerId);
      await repo.lock();
      return mutate(repo, context);
    },
  );
}
/** Budgets live on top-level expense categories; subcategory spending rolls up into them. */
async function requireBudgetCategory(
  context: WriteContext,
  categoryId: string,
  { allowArchived }: { allowArchived: boolean },
) {
  const category = (
    await expenseCategoryOverview(context.tx, context.ledgerId)
  ).find((item) => item.id.toLowerCase() === categoryId.toLowerCase());
  if (!category)
    throw new ApiProblem(404, "Not found", "Expense category not found.");
  if (category.parentId)
    conflict("categoryId", "Budgets are set on top-level categories.");
  if (category.archived && !allowArchived)
    conflict("categoryId", "Choose an active category.");
  return category;
}

export function setBudget(
  db: Database,
  identity: WriteIdentity,
  body: SetBudget,
) {
  const { expectedVersion, ...rest } = body;
  const request =
    expectedVersion === undefined ? rest : { ...rest, expectedVersion };
  return write(db, identity, "PUT budgets", request, async (repo, context) => {
    const existing = await repo.findForMonth(body.categoryId, body.month);
    if (expectedVersion === undefined) {
      if (existing)
        conflict(
          "month",
          "This category already has a budget for the month. Reload and edit it.",
        );
      await requireBudgetCategory(context, body.categoryId, {
        allowArchived: false,
      });
      return {
        status: 201,
        body: budgetDto(
          await requireCreated(
            repo.create({
              categoryId: body.categoryId,
              month: body.month,
              amount: body.amount.amount,
              rollover: body.rollover,
            }),
          ),
        ),
      };
    }
    if (!existing) throw new ApiProblem(404, "Not found", "Budget not found.");
    const version = nextVersion(existing.version, expectedVersion);
    return {
      status: 200,
      body: budgetDto(
        requireVersionUpdate(
          await repo.update(
            existing.id,
            expectedVersion,
            { amount: body.amount.amount, rollover: body.rollover },
            version,
          ),
        ),
      ),
    };
  });
}
async function requireCreated(created: Promise<BudgetRow | undefined>) {
  const row = await created;
  if (!row) throw new Error("Budget was not created");
  return row;
}

export function deleteBudget(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: DeleteBudget,
) {
  return write(
    db,
    identity,
    `DELETE budgets/${id.toLowerCase()}`,
    body,
    async (repo) => {
      const current = await repo.find(id);
      if (!current) throw new ApiProblem(404, "Not found", "Budget not found.");
      const version = nextVersion(current.version, body.expectedVersion);
      requireVersionUpdate(
        await repo.update(
          id,
          body.expectedVersion,
          { deletedAt: new Date() },
          version,
        ),
      );
      return { status: 204, body: null };
    },
  );
}

/** Copies one month's budgets into another, skipping categories that already have one. */
export function copyBudgets(
  db: Database,
  identity: WriteIdentity,
  body: CopyBudgets,
) {
  return write(
    db,
    identity,
    "POST budgets/copy",
    body,
    async (repo, context) => {
      const categories = new Map(
        (await expenseCategoryOverview(context.tx, context.ledgerId)).map(
          (category) => [category.id, category],
        ),
      );
      const existing = new Set(
        (await repo.inMonth(body.toMonth)).map((row) => row.categoryId),
      );
      const created: Budget[] = [];
      for (const row of await repo.inMonth(body.fromMonth)) {
        const category = categories.get(row.categoryId);
        if (existing.has(row.categoryId) || !category || category.archived)
          continue;
        created.push(
          budgetDto(
            await requireCreated(
              repo.create({
                categoryId: row.categoryId,
                month: body.toMonth,
                amount: row.amount,
                rollover: row.rollover,
              }),
            ),
          ),
        );
      }
      return { status: 201, body: { items: created } };
    },
  );
}
