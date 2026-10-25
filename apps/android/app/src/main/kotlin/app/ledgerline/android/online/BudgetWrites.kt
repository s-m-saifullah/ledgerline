package app.ledgerline.android.online

import app.ledgerline.api.Budget
import app.ledgerline.api.ExpectedVersion
import app.ledgerline.api.SetBudget
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Setting and removing a month's limit for a category (ADR 0046, Budgets). Each is one idempotent REST call with the
 * caller's key. Budgets are read online and never kept on the phone, so there is no mirror to update: the screen
 * reads them again after a write.
 */
@Singleton
class BudgetWrites @Inject constructor(private val writer: OnlineWriter) {
    suspend fun set(ledgerId: String, key: String, body: SetBudget): Written<Budget> = writer.write { setBudget(ledgerId, key, body) }

    suspend fun remove(ledgerId: String, budgetId: String, key: String, expectedVersion: Int): Written<Unit> =
        writer.write { deleteBudget(ledgerId, budgetId, key, ExpectedVersion(expectedVersion)) }
}
