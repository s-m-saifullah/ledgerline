package app.ledgerline.api

import kotlinx.serialization.Serializable

/**
 * `PUT /ledgers/{ledgerId}/budgets`: a category's budget for a month. Without [expectedVersion] it creates the budget
 * (201); with the version the phone holds it edits the existing one (200). [rollover] is always sent, so an edit keeps
 * what the web chose: the phone never changes it.
 */
@Serializable
data class SetBudget(
    val categoryId: String,
    val month: String,
    val amount: Money,
    val rollover: Boolean,
    val expectedVersion: Int? = null,
)
