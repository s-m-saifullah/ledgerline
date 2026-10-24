package app.ledgerline.android.ui.insights

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
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
import app.ledgerline.android.ui.format.monthLabel
import app.ledgerline.android.ui.format.sharePercent
import app.ledgerline.android.ui.home.ListBottomSpace
import app.ledgerline.android.ui.home.Muted
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.api.Money

/** What is open on the screen: a main category's subcategories (by its id) and each chart's figures. */
const val CashFlowFigures = "figures:cash-flow"
const val NetWorthFigures = "figures:net-worth"

/**
 * Insights as on the web (ADR 0045), read-only: the month switcher, what was spent with money in and net, spending
 * by category (a main category opens to its subcategories), and money in and out and net worth over twelve months,
 * each with its figures. [open] holds what the owner opened, so the content stays a function of plain data.
 */
@Composable
internal fun InsightsContent(
    month: String,
    state: Online<Insights>,
    open: Set<String>,
    onToggle: (String) -> Unit,
    onOpenCategory: (categoryId: String) -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(modifier = modifier, contentPadding = PaddingValues(bottom = ListBottomSpace), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            PageHeader(
                stringResource(R.string.insights_title),
                eyebrow = stringResource(R.string.eyebrow_personal),
                below = { MonthSwitcher(month, onPrevious, onNext) },
            )
        }
        when (state) {
            Online.Loading -> item { LedgerCard { Muted(stringResource(R.string.insights_loading)) } }
            Online.Offline -> item { RetryNote(stringResource(R.string.insights_offline), onRetry) }
            Online.Failed -> item { RetryNote(stringResource(R.string.insights_failed), onRetry) }
            is Online.Ready -> ready(state.value, open, onToggle, onOpenCategory)
        }
    }
}

private fun LazyListScope.ready(insights: Insights, open: Set<String>, onToggle: (String) -> Unit, onOpenCategory: (String) -> Unit) {
    val (spending, flow, worth) = insights
    val month = spending.month
    item { Summary(insights) }
    item { Heading(stringResource(R.string.insights_by_category)) }
    if (spending.categories.isEmpty()) {
        item { Line(stringResource(R.string.insights_no_spending, monthLabel(month))) }
    }
    spending.categories.forEach { line ->
        item(key = line.categoryId) {
            val name = named(line.name, line.archived)
            if (line.children.isEmpty()) {
                SpendingCard(name, line.amount, spending.total.amount, onOpen = { onOpenCategory(line.categoryId) })
            } else {
                val opened = line.categoryId in open
                SpendingCard(
                    name,
                    line.amount,
                    spending.total.amount,
                    detail = pluralStringResource(R.plurals.insights_subcategories, line.children.size, line.children.size),
                    opened = opened,
                    onToggle = { onToggle(line.categoryId) },
                )
                if (opened) {
                    Column(modifier = Modifier.padding(start = 16.dp, top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        line.children.forEach { child -> SpendingCard(named(child.name, child.archived), child.amount, spending.total.amount, onOpen = { onOpenCategory(child.categoryId) }) }
                        val direct = line.amount.amount - line.children.sumOf { it.amount.amount }
                        if (direct > 0) {
                            // The main category's own entries only, as the web's "directly in" line.
                            SpendingCard(stringResource(R.string.insights_directly_in, line.name), Money(direct, line.amount.currency), spending.total.amount, onOpen = { onOpenCategory(line.categoryId) })
                        }
                    }
                }
            }
        }
    }
    item { Heading(stringResource(R.string.insights_flow_heading, monthLabel(month))) }
    item {
        if (flow.months.any { it.income.amount > 0 || it.spending.amount > 0 }) {
            CashFlowChart(flow, month, open = CashFlowFigures in open, onToggle = { onToggle(CashFlowFigures) })
        } else {
            Line(stringResource(R.string.insights_flow_empty))
        }
    }
    item {
        val count = worth.months.size
        Heading(
            when (count) {
                ChartMonths -> stringResource(R.string.insights_worth_heading_twelve, monthLabel(month))
                0 -> stringResource(R.string.insights_worth_heading_to, monthLabel(month))
                else -> stringResource(R.string.insights_worth_heading_since, monthLabel(worth.months.first().month))
            },
        )
    }
    item { NetWorthChart(worth, month, open = NetWorthFigures in open, onToggle = { onToggle(NetWorthFigures) }) }
}

/** "Spent in October 2026", with money in and net for the month when the cash flow has it. */
@Composable
private fun Summary(insights: Insights) {
    val spending = insights.spending
    val selected = insights.cashFlow.months.find { it.month == spending.month }
    StatCard(
        stringResource(R.string.insights_spent_in, monthLabel(spending.month)),
        money(spending.total.amount, spending.total.currency),
        selected?.let {
            stringResource(R.string.insights_in_and_net, money(it.income.amount, it.income.currency).text, money(it.net.amount, it.net.currency).text)
        } ?: "",
        modifier = Modifier.padding(bottom = 8.dp),
    )
}

/** `.insight-line`: a category, its amount, its share as a bar and as "23.7% of spending"; a main category opens. */
@Composable
internal fun SpendingCard(
    name: String,
    amount: Money,
    total: Long,
    detail: String? = null,
    opened: Boolean = false,
    onToggle: (() -> Unit)? = null,
    /** A card that has no subcategories opens that category's entries for the month. */
    onOpen: (() -> Unit)? = null,
) {
    val shown = money(amount.amount, amount.currency)
    val share = stringResource(R.string.insights_share, sharePercent(amount.amount, total))
    val words = listOfNotNull(share, detail).joinToString(" · ")
    val state = onToggle?.let { stringResource(if (opened) R.string.expanded else R.string.collapsed) }
    LedgerCard(
        padding = PaddingValues(16.dp),
        modifier = Modifier
            .let { if (onToggle != null) it.clickable(onClick = onToggle) else if (onOpen != null) it.clickable(onClick = onOpen) else it }
            .clearAndSetSemantics {
                contentDescription = listOf(name, shown.spoken, words).joinToString(", ")
                if (onOpen != null) role = Role.Button
                if (state != null) {
                    role = Role.Button
                    stateDescription = state
                }
            },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TitleAndAmount(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f, fill = false))
                        if (onToggle != null) {
                            Spacer(Modifier.width(6.dp))
                            Icon(
                                painterResource(R.drawable.ic_chevron_right),
                                contentDescription = null,
                                modifier = Modifier.size(20.dp).rotate(if (opened) 270f else 90f),
                            )
                        }
                    }
                },
                amount = { Text(shown.text, style = MaterialTheme.typography.bodyLarge.tabular(), maxLines = 1, softWrap = false) },
            )
            ShareBar(if (total > 0) (amount.amount.toDouble() / total).toFloat() else 0f)
            Text(words, style = MaterialTheme.typography.bodySmall.tabular(), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun named(name: String, archived: Boolean) = if (archived) stringResource(R.string.insights_archived, name) else name

/** `.insight-heading`: a section's 16 sp heading, 24 dp above and 12 dp below as on the web (less the list gap). */
@Composable
private fun Heading(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.padding(start = ScreenMargin, end = ScreenMargin, top = 16.dp, bottom = 4.dp).semantics { heading() },
    )
}

@Composable
private fun Line(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = ScreenMargin))
}
