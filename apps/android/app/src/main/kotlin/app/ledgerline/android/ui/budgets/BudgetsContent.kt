package app.ledgerline.android.ui.budgets

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.online.Online
import app.ledgerline.android.ui.design.LedgerCard
import app.ledgerline.android.ui.design.MonthSwitcher
import app.ledgerline.android.ui.design.PageHeader
import app.ledgerline.android.ui.design.RetryNote
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.ShareBar
import app.ledgerline.android.ui.design.StatCard
import app.ledgerline.android.ui.design.TitleAndAmount
import app.ledgerline.android.ui.design.tabular
import app.ledgerline.android.ui.home.ListBottomSpace
import app.ledgerline.android.ui.home.Muted
import app.ledgerline.android.ui.format.monthLabel
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.android.ui.theme.LocalPalette
import app.ledgerline.api.BudgetLine
import app.ledgerline.api.BudgetMonth
import kotlin.math.abs

/** How much of the month's allowance (budget plus carried in) is used, between 0 and 1, as the web's bar. */
fun usedShare(line: BudgetLine): Float {
    val budget = line.budget ?: return 0f
    val allowance = budget.amount.amount + line.carriedIn.amount
    if (allowance <= 0) return if (line.spent.amount > 0) 1f else 0f
    return (line.spent.amount.toDouble() / allowance).coerceIn(0.0, 1.0).toFloat()
}

/**
 * Budgets as on the web (ADR 0045), read-only: the month switcher, Left this month, one card per category with
 * its bar, and what was spent without a budget. Setting and copying budgets stay on the web (ADR 0043).
 */
@Composable
internal fun BudgetsContent(
    month: String,
    state: Online<BudgetMonth>,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(modifier = modifier, contentPadding = PaddingValues(bottom = ListBottomSpace), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            PageHeader(
                stringResource(R.string.budgets_title),
                eyebrow = stringResource(R.string.eyebrow_personal),
                below = { MonthSwitcher(month, onPrevious, onNext) },
            )
        }
        when (state) {
            Online.Loading -> item { LedgerCard { Muted(stringResource(R.string.budgets_loading)) } }
            Online.Offline -> item { RetryNote(stringResource(R.string.budgets_offline), onRetry) }
            Online.Failed -> item { RetryNote(stringResource(R.string.budgets_failed), onRetry) }
            is Online.Ready -> {
                val view = state.value
                val hasBudgets = view.items.any { it.budget != null }
                item { Summary(view, hasBudgets) }
                if (view.items.isEmpty()) {
                    item { Text(stringResource(R.string.budgets_no_categories), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = ScreenMargin)) }
                }
                items(view.items, key = { it.categoryId }) { LineCard(it) }
                if (hasBudgets && view.totals.unbudgetedSpent.amount > 0) {
                    item {
                        val unbudgeted = money(view.totals.unbudgetedSpent.amount, view.totals.unbudgetedSpent.currency)
                        val spoken = stringResource(R.string.budgets_unbudgeted, unbudgeted.spoken)
                        Text(
                            stringResource(R.string.budgets_unbudgeted, unbudgeted.text),
                            style = MaterialTheme.typography.bodyMedium.tabular(),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier
                                .padding(horizontal = ScreenMargin)
                                .clearAndSetSemantics { contentDescription = spoken },
                        )
                    }
                }
            }
        }
    }
}

/** Left this month and the totals, or the read-only "no budgets yet" card. */
@Composable
private fun Summary(view: BudgetMonth, hasBudgets: Boolean) {
    val totals = view.totals
    if (hasBudgets) {
        val budgeted = money(totals.budgeted.amount, totals.budgeted.currency).text
        val spent = money(totals.spent.amount, totals.spent.currency).text
        val detail = if (totals.carriedIn.amount != 0L) {
            stringResource(R.string.budgets_totals_carried, budgeted, spent, money(totals.carriedIn.amount, totals.carriedIn.currency).text)
        } else {
            stringResource(R.string.budgets_totals, budgeted, spent)
        }
        StatCard(
            stringResource(R.string.budgets_left_this_month),
            money(totals.left.amount, totals.left.currency),
            detail,
            modifier = Modifier.padding(bottom = 8.dp),
            amountColor = if (totals.left.amount < 0) LocalPalette.current.danger else Color.Unspecified,
        )
    } else {
        LedgerCard(modifier = Modifier.padding(bottom = 8.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.budgets_none, monthLabel(view.month)), style = MaterialTheme.typography.bodyLarge)
                Muted(stringResource(R.string.budgets_none_detail))
            }
        }
    }
}

/** `.budget-line`: the category and what is left (red when over), the bar, and what was spent of what. */
@Composable
internal fun LineCard(line: BudgetLine) {
    val palette = LocalPalette.current
    val left = line.left
    val over = (left?.amount ?: 0L) < 0
    val (shownLeft, spokenLeft) = if (left == null) {
        stringResource(R.string.budget_none).let { it to it }
    } else {
        val amount = money(abs(left.amount), left.currency)
        val words = if (over) R.string.budget_over else R.string.budget_left
        stringResource(words, amount.text) to stringResource(words, amount.spoken)
    }
    val details = lineDetails(line)
    LedgerCard(
        padding = PaddingValues(16.dp),
        modifier = Modifier.clearAndSetSemantics {
            contentDescription = (listOf(line.name, spokenLeft) + details.map { it.second }).joinToString(", ")
        },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TitleAndAmount(
                title = { Text(line.name, style = MaterialTheme.typography.titleMedium) },
                amount = {
                    Text(
                        shownLeft,
                        style = MaterialTheme.typography.bodyLarge.tabular(),
                        color = when {
                            over -> palette.danger
                            left == null -> MaterialTheme.colorScheme.onSurfaceVariant
                            else -> MaterialTheme.colorScheme.onSurface
                        },
                        maxLines = 1,
                        softWrap = false,
                    )
                },
            )
            if (line.budget != null) ShareBar(usedShare(line), danger = over)
            Text(
                details.joinToString(" · ") { it.first },
                style = MaterialTheme.typography.bodySmall.tabular(),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** The muted line under a category, as shown and as read aloud: "Spent X of Y", then what was carried. */
@Composable
private fun lineDetails(line: BudgetLine): List<Pair<String, String>> {
    val spent = money(line.spent.amount, line.spent.currency)
    val budget = line.budget
    return if (budget != null) {
        val of = money(budget.amount.amount, budget.amount.currency)
        val carried = line.carriedIn.amount
        listOfNotNull(
            stringResource(R.string.budget_spent_of, spent.text, of.text) to stringResource(R.string.budget_spent_of, spent.spoken, of.spoken),
            if (carried != 0L) {
                val amount = money(abs(carried), line.carriedIn.currency)
                val words = if (carried > 0) R.string.budget_carried_over else R.string.budget_overspent
                stringResource(words, amount.text) to stringResource(words, amount.spoken)
            } else {
                null
            },
        )
    } else if (line.spent.amount > 0) {
        listOf(stringResource(R.string.budget_spent, spent.text) to stringResource(R.string.budget_spent, spent.spoken))
    } else {
        stringResource(R.string.budget_nothing_spent).let { listOf(it to it) }
    }
}
