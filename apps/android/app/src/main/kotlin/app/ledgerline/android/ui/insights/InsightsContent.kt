package app.ledgerline.android.ui.insights

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.online.Online
import app.ledgerline.android.ui.design.Avatar
import app.ledgerline.android.ui.design.CardGap
import app.ledgerline.android.ui.design.GroupedListCard
import app.ledgerline.android.ui.design.LedgerCard
import app.ledgerline.android.ui.design.LimitState
import app.ledgerline.android.ui.design.MonthControl
import app.ledgerline.android.ui.design.ProportionBar
import app.ledgerline.android.ui.design.RetryNote
import app.ledgerline.android.ui.design.RowHeight
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SectionLabel
import app.ledgerline.android.ui.design.SegmentedBar
import app.ledgerline.android.ui.design.TitleAndAmount
import app.ledgerline.android.ui.design.TopBar
import app.ledgerline.android.ui.design.chartColor
import app.ledgerline.android.ui.design.tabular
import app.ledgerline.android.ui.format.monthLabel
import app.ledgerline.android.ui.format.sharePercent
import app.ledgerline.android.ui.home.ListBottomSpace
import app.ledgerline.android.ui.home.Muted
import app.ledgerline.android.ui.home.cashFlow
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.android.ui.theme.LocalPalette
import app.ledgerline.api.Money

/** What is open on the screen: a main category's subcategories (by its id) and each chart's figures. */
const val CashFlowFigures = "figures:cash-flow"
const val NetWorthFigures = "figures:net-worth"

/**
 * Insights (ADR 0046), read-only: a top bar with the month under the title, one summary card (what was spent, money
 * in and net, and how much of the money in was kept), one category card (a main category opens to its subcategories),
 * the 12-month chart only when two or more months have activity, and net worth: today's assets and liabilities, then
 * the chart. [open] holds what the owner opened and [snapshot] today's assets and liabilities, so the content stays a
 * function of plain data.
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
    snapshot: WorthSnapshot? = null,
) {
    Column(modifier = modifier) {
        TopBar(stringResource(R.string.insights_title))
        // Under the title, as on Budgets, so a long month or the largest text cannot squeeze the title into pieces.
        Row(modifier = Modifier.padding(start = 4.dp)) { MonthControl(month, onPrevious, onNext) }
        LazyColumn(contentPadding = PaddingValues(bottom = ListBottomSpace), verticalArrangement = Arrangement.spacedBy(CardGap)) {
            when (state) {
                Online.Loading -> item { LedgerCard { Muted(stringResource(R.string.insights_loading)) } }
                Online.Offline -> item { RetryNote(stringResource(R.string.insights_offline), onRetry) }
                Online.Failed -> item { RetryNote(stringResource(R.string.insights_failed), onRetry) }
                is Online.Ready -> ready(state.value, snapshot, open, onToggle, onOpenCategory)
            }
        }
    }
}

private fun LazyListScope.ready(insights: Insights, snapshot: WorthSnapshot?, open: Set<String>, onToggle: (String) -> Unit, onOpenCategory: (String) -> Unit) {
    val (spending, flow, worth) = insights
    val month = spending.month
    item { Summary(insights) }
    if (spending.categories.isEmpty()) {
        item { Line(stringResource(R.string.insights_no_spending, monthLabel(month))) }
    } else {
        item { Categories(insights, open, onToggle, onOpenCategory) }
    }
    if (showCashFlow(flow)) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SectionLabel(stringResource(R.string.insights_flow_heading))
                CashFlowChart(flow, month, open = CashFlowFigures in open, onToggle = { onToggle(CashFlowFigures) })
            }
        }
    }
    if (snapshot != null) item { Snapshot(snapshot) }
    item {
        val count = worth.months.size
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionLabel(
                when (count) {
                    ChartMonths -> stringResource(R.string.insights_worth_heading_twelve)
                    0 -> stringResource(R.string.insights_worth_heading)
                    else -> stringResource(R.string.insights_worth_heading_since, monthLabel(worth.months.first().month))
                },
            )
            NetWorthChart(worth, month, open = NetWorthFigures in open, onToggle = { onToggle(NetWorthFigures) })
        }
    }
}

/**
 * What was spent, with money in and net for the month when the cash flow has it, and how much of the money in was
 * kept: a bar of spent and kept (all red when more went out than came in) and a line for each with its share.
 */
@Composable
private fun Summary(insights: Insights) {
    val palette = LocalPalette.current
    val total = insights.spending.total
    val row = insights.cashFlow.months.find { it.month == insights.spending.month }
    val spent = money(total.amount, total.currency)
    val label = stringResource(R.string.insights_spent)
    val figures = row?.let { cashFlow(it.income, total) }
    val income = row?.income?.amount ?: 0L
    val moneyIn = row?.let { money(it.income.amount, it.income.currency) }
    val net = figures?.let { money(it.net.amount, it.net.currency) }
    val inAndNet = if (moneyIn != null && net != null) stringResource(R.string.insights_in_and_net, moneyIn.text, net.text) else null
    val inAndNetSpoken = if (moneyIn != null && net != null) stringResource(R.string.insights_in_and_net, moneyIn.spoken, net.spoken) else null
    val kept = figures?.takeIf { income > 0 && it.net.amount >= 0 }
    val spentShare = kept?.let { sharePercent(total.amount, income) }
    val keptShare = kept?.let { sharePercent(it.net.amount, income) }
    val keptMoney = kept?.let { money(it.net.amount, it.net.currency) }
    val keptLabel = stringResource(R.string.insights_kept)
    val spoken = listOfNotNull(
        label, spent.spoken, inAndNetSpoken,
        spentShare?.let { stringResource(R.string.insights_detail, "$label ${spent.spoken}", it) },
        keptShare?.let { stringResource(R.string.insights_detail, "$keptLabel ${keptMoney?.spoken}", it) },
    ).joinToString(", ")
    val masked = spent.spoken != spent.text
    LedgerCard(
        modifier = if (masked) Modifier.clearAndSetSemantics { contentDescription = spoken } else Modifier,
        padding = PaddingValues(16.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(spent.text, style = MaterialTheme.typography.displaySmall.tabular(), maxLines = 1, softWrap = false)
            if (inAndNet != null) Text(inAndNet, style = MaterialTheme.typography.bodySmall.tabular(), color = MaterialTheme.colorScheme.onSurfaceVariant)
            when (val bar = summaryBar(income, total.amount)) {
                SummaryBar.None -> Unit
                is SummaryBar.Split -> SegmentedBar(listOf(bar.spent, 1f - bar.spent))
                SummaryBar.Over -> ProportionBar(1f, LimitState.Over)
            }
            if (kept != null && spentShare != null && keptShare != null && keptMoney != null) {
                DetailLine(chartColor(palette, 0), label, spent.text, spentShare)
                DetailLine(chartColor(palette, 1), keptLabel, keptMoney.text, keptShare)
            }
        }
    }
}

/** A key square in the bar's colour, a name, and the amount with its share: colour is never the only cue. */
@Composable
private fun DetailLine(color: Color, name: String, amount: String, share: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(modifier = Modifier.size(10.dp).clip(RoundedCornerShape(2.dp)).background(color))
        Text(name, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        Text(stringResource(R.string.insights_detail, amount, share), style = MaterialTheme.typography.bodySmall.tabular(), maxLines = 1, softWrap = false)
    }
}

/** Spending by category: one card, a main category's row opening to its subcategories and what was entered directly in it. */
@Composable
private fun Categories(insights: Insights, open: Set<String>, onToggle: (String) -> Unit, onOpenCategory: (String) -> Unit) {
    val spending = insights.spending
    val total = spending.total.amount
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionLabel(stringResource(R.string.insights_by_category))
        GroupedListCard {
            spending.categories.forEach { line ->
                row {
                    val name = named(line.name, line.archived)
                    if (line.children.isEmpty()) {
                        SpendingRow(name, line.amount, total, onOpen = { onOpenCategory(line.categoryId) })
                    } else {
                        val opened = line.categoryId in open
                        Column {
                            SpendingRow(
                                name,
                                line.amount,
                                total,
                                subcategories = line.children.size,
                                opened = opened,
                                onToggle = { onToggle(line.categoryId) },
                            )
                            if (opened) {
                                line.children.forEach { child ->
                                    SpendingRow(named(child.name, child.archived), child.amount, total, nested = true, onOpen = { onOpenCategory(child.categoryId) })
                                }
                                val direct = line.amount.amount - line.children.sumOf { it.amount.amount }
                                if (direct > 0) {
                                    // The main category's own entries only, as the web's "directly in" line.
                                    SpendingRow(
                                        stringResource(R.string.insights_directly_in, line.name),
                                        Money(direct, line.amount.currency),
                                        total,
                                        nested = true,
                                        onOpen = { onOpenCategory(line.categoryId) },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * One category: its initials, the name with its share of the spending (and how many subcategories it has) under it,
 * the amount, and a bar of the share. A main category with subcategories opens and closes; any other row opens that
 * category's entries for the month. A [nested] row (a subcategory) has no initials, keeps its bar (of the same total), and sits under its parent.
 */
@Composable
internal fun SpendingRow(
    name: String,
    amount: Money,
    total: Long,
    subcategories: Int = 0,
    opened: Boolean = false,
    nested: Boolean = false,
    onToggle: (() -> Unit)? = null,
    onOpen: (() -> Unit)? = null,
) {
    val shown = money(amount.amount, amount.currency)
    val share = sharePercent(amount.amount, total)
    val hint = if (subcategories > 0) stringResource(R.string.insights_detail, share, pluralStringResource(R.plurals.insights_subcategories, subcategories, subcategories)) else share
    val state = onToggle?.let { stringResource(if (opened) R.string.expanded else R.string.collapsed) }
    val aloud = listOf(name, shown.spoken, hint).joinToString(", ")
    val click = onToggle ?: onOpen
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (click != null) Modifier.clickable(role = Role.Button, onClick = click) else Modifier)
            .heightIn(min = RowHeight)
            .padding(start = if (nested) 68.dp else 16.dp, end = 16.dp, top = 8.dp, bottom = 8.dp)
            .testTag("row-$name")
            .then(if (state != null) Modifier.semantics { stateDescription = state } else Modifier)
            .then(if (shown.spoken != shown.text) Modifier.clearAndSetSemantics { contentDescription = aloud; if (state != null) stateDescription = state } else Modifier),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (!nested) Avatar(name)
            TitleAndAmount(
                title = {
                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(
                                name,
                                style = if (nested) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.titleMedium,
                                modifier = Modifier.weight(1f, fill = false),
                            )
                            if (onToggle != null) {
                                Icon(
                                    painterResource(if (opened) R.drawable.ic_chevron_down else R.drawable.ic_chevron_right),
                                    contentDescription = null,
                                    tint = LocalPalette.current.muted,
                                    modifier = Modifier.size(20.dp),
                                )
                            }
                        }
                        Text(hint, style = MaterialTheme.typography.bodySmall.tabular(), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
                amount = { Text(shown.text, style = (if (nested) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.titleMedium).tabular(), maxLines = 1, softWrap = false) },
                minTitle = 80.dp,
                modifier = Modifier.weight(1f),
            )
        }
        Box(modifier = Modifier.testTag("bar-$name")) { ProportionBar(if (total > 0) (amount.amount.toDouble() / total).toFloat() else 0f) }
    }
}

/** Net worth today: the figure, and what is held and owed that it is made of. Hidden amounts go through [money]. */
@Composable
private fun Snapshot(snapshot: WorthSnapshot) {
    val net = money(snapshot.net.amount, snapshot.net.currency)
    val assets = money(snapshot.assets.amount, snapshot.assets.currency)
    val liabilities = money(snapshot.liabilities.amount, snapshot.liabilities.currency)
    val spoken = listOf(
        stringResource(R.string.insights_worth_now), net.spoken,
        "${stringResource(R.string.insights_assets)} ${assets.spoken}", "${stringResource(R.string.insights_liabilities)} ${liabilities.spoken}",
    ).joinToString(", ")
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionLabel(stringResource(R.string.insights_worth_now))
        LedgerCard(
            modifier = if (net.spoken != net.text) Modifier.clearAndSetSemantics { contentDescription = spoken } else Modifier,
            padding = PaddingValues(16.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(net.text, style = MaterialTheme.typography.displaySmall.tabular(), maxLines = 1, softWrap = false)
                SnapshotLine(stringResource(R.string.insights_assets), assets.text)
                SnapshotLine(stringResource(R.string.insights_liabilities), liabilities.text)
            }
        }
    }
}

@Composable
private fun SnapshotLine(name: String, amount: String) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(name, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        Text(amount, style = MaterialTheme.typography.bodyMedium.tabular(), maxLines = 1, softWrap = false)
    }
}

@Composable
private fun named(name: String, archived: Boolean) = if (archived) stringResource(R.string.insights_archived, name) else name

@Composable
private fun Line(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = ScreenMargin))
}
