package app.ledgerline.android.ui.home

import app.ledgerline.android.mirror.AccountBalance
import app.ledgerline.android.mirror.CategoryRow
import app.ledgerline.android.mirror.EntryFilters
import app.ledgerline.android.mirror.TagRow
import app.ledgerline.android.ui.design.Choice
import app.ledgerline.android.ui.editor.categoryChoices
import java.time.YearMonth

/** What the Transactions filters offer: every account, category and tag of the ledger, archived ones included. */
data class FilterOptions(
    val accounts: List<Choice> = emptyList(),
    val categories: List<Choice> = emptyList(),
    val tags: List<Choice> = emptyList(),
)

internal fun filterOptions(accounts: List<AccountBalance>, categories: List<CategoryRow>, tags: List<TagRow>) = FilterOptions(
    accounts = accounts.map { Choice(it.id, it.name, it.currency, archived = it.archivedAt != null) },
    // Expense categories first, then income, each in the web's order (a transfer has no category).
    categories = categoryChoices(categories, "expense", null, includeArchived = true) + categoryChoices(categories, "income", null, includeArchived = true),
    tags = tags.sortedBy { it.name.lowercase() }.map { Choice(it.id, it.name, archived = it.archivedAt != null) },
)

/** Home's "Show the pending entries": Transactions narrowed to what the balance leaves out. */
internal val PendingEntries = EntryFilters(status = "pending")

/**
 * An Insights spending row's entries: that category alone (its subcategories have rows of their own, and a main
 * category's "directly in" row means its own entries) for the whole month shown, as the web's links.
 */
internal fun categoryEntries(categoryId: String, month: YearMonth) = EntryFilters(
    categoryId = categoryId,
    includeSubcategories = false,
    from = month.atDay(1).toString(),
    to = month.atEndOfMonth().toString(),
)
