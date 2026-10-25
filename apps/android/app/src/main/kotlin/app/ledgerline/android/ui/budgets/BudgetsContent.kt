package app.ledgerline.android.ui.budgets

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.online.Online
import app.ledgerline.android.ui.design.Avatar
import app.ledgerline.android.ui.design.CardGap
import app.ledgerline.android.ui.design.GroupedListCard
import app.ledgerline.android.ui.design.LedgerCard
import app.ledgerline.android.ui.design.MonthControl
import app.ledgerline.android.ui.design.ProportionBar
import app.ledgerline.android.ui.design.RetryNote
import app.ledgerline.android.ui.design.RowHeight
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SectionLabel
import app.ledgerline.android.ui.design.TitleAndAmount
import app.ledgerline.android.ui.design.TopBar
import app.ledgerline.android.ui.design.limitState
import app.ledgerline.android.ui.design.tabular
import app.ledgerline.android.ui.format.shortMonth
import app.ledgerline.android.ui.home.ListBottomSpace
import app.ledgerline.android.ui.home.Muted
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.android.ui.theme.LocalPalette
import app.ledgerline.api.BudgetLine
import app.ledgerline.api.BudgetMonth
import app.ledgerline.api.Money
import java.time.LocalDate
import java.time.YearMonth
import kotlin.math.abs

/** How much of the month's allowance (budget plus carried in) is used, between 0 and 1: a bar's fill. */
fun usedShare(line: BudgetLine): Float {
    val budget = line.budget ?: return 0f
    return shareOf(line.spent.amount, budget.amount.amount + line.carriedIn.amount)
}

/**
 * Budgets (ADR 0046), read-only: a top bar with the month, then a hero (what is left, or that no monthly target is
 * set), one ranked list and one line folding the categories with nothing planned or spent. Setting limits stays on
 * the web for now (ADR 0043).
 */
@Composable
internal fun BudgetsContent(
    month: String,
    state: Online<BudgetMonth>,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    today: LocalDate = LocalDate.now(),
    limit: LimitUi? = null,
    limitActions: LimitActions? = null,
) {
    Column(modifier = modifier) {
        TopBar(stringResource(R.string.budgets_title))
        // Under the title, as in the concept, so a long month or the largest text cannot squeeze the title into pieces.
        Row(modifier = Modifier.padding(start = 4.dp)) { MonthControl(month, onPrevious, onNext) }
        LazyColumn(contentPadding = PaddingValues(bottom = ListBottomSpace), verticalArrangement = Arrangement.spacedBy(CardGap)) {
            when (state) {
                Online.Loading -> item { LedgerCard { Muted(stringResource(R.string.budgets_loading)) } }
                Online.Offline -> item { RetryNote(stringResource(R.string.budgets_offline), onRetry) }
                Online.Failed -> item { RetryNote(stringResource(R.string.budgets_failed), onRetry) }
                is Online.Ready -> monthItems(state.value, today, limitActions)
            }
        }
    }
    // The Set limit sheet, over the screen while one is open.
    if (limit != null && limitActions != null) LimitSheet(limit, limitActions)
}

private fun LazyListScope.monthItems(view: BudgetMonth, today: LocalDate, actions: LimitActions?) {
    if (view.items.isEmpty()) {
        item { Text(stringResource(R.string.budgets_no_categories), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = ScreenMargin)) }
        return
    }
    val targetSet = view.items.any { it.budget != null }
    val groups = splitLines(view.items)
    val total = totalSpent(view.items)
    item { if (targetSet) LeftHero(view, YearMonth.parse(view.month), today) else NoTargetHero(Money(total, view.items.first().spent.currency), groups.active.size) }
    if (groups.active.isNotEmpty()) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SectionLabel(stringResource(R.string.budgets_categories, groups.active.size))
                val monthName = shortMonth(view.month)
                GroupedListCard { groups.active.forEach { line -> row { BudgetRow(line, monthName, total, targetSet, onOpen = actions?.let { a -> { a.open(line) } }) } } }
            }
        }
    }
    if (groups.folded.isNotEmpty()) item { FoldedLine(groups.folded, actions) }
}

/** Left this month: the figure (red when over), what it is left of, a bar, how much is used and the days left. */
@Composable
private fun LeftHero(view: BudgetMonth, month: YearMonth, today: LocalDate) {
    val palette = LocalPalette.current
    val totals = view.totals
    val allowance = totals.budgeted.amount + totals.carriedIn.amount
    val left = money(totals.left.amount, totals.left.currency)
    val of = money(allowance, totals.budgeted.currency)
    val over = totals.left.amount < 0
    val used = percentUsed(totals.spent.amount, allowance)
    val days = daysLeft(month, today)?.let { pluralStringResource(R.plurals.budgets_days_left, it, it) }
    val usedLine = when {
        used != null && days != null -> stringResource(R.string.budgets_used_days, used, days)
        used != null -> stringResource(R.string.budgets_used, used)
        else -> days
    }
    val unbudgeted = totals.unbudgetedSpent.takeIf { it.amount > 0 }?.let { money(it.amount, it.currency) }
    val label = stringResource(R.string.budgets_left_this_month)
    val spoken = listOfNotNull(
        label, left.spoken, stringResource(R.string.budgets_of, of.spoken), usedLine,
        unbudgeted?.let { stringResource(R.string.budgets_unbudgeted, it.spoken) },
    ).joinToString(", ")
    LedgerCard(
        modifier = if (left.spoken != left.text) Modifier.clearAndSetSemantics { contentDescription = spoken } else Modifier,
        padding = PaddingValues(16.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    left.text,
                    style = MaterialTheme.typography.displaySmall.tabular(),
                    color = if (over) palette.danger else MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    softWrap = false,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Text(stringResource(R.string.budgets_of, of.text), style = MaterialTheme.typography.bodyMedium.tabular(), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 4.dp))
            }
            ProportionBar(shareOf(totals.spent.amount, allowance), limitState(totals.spent.amount, allowance))
            if (usedLine != null) Text(usedLine, style = MaterialTheme.typography.bodySmall.tabular(), color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (unbudgeted != null) {
                Text(stringResource(R.string.budgets_unbudgeted, unbudgeted.text), style = MaterialTheme.typography.bodySmall.tabular(), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** No budget is set this month: what was spent so far and across how many categories. */
@Composable
private fun NoTargetHero(total: Money, categories: Int) {
    val spent = money(total.amount, total.currency)
    val sentence = pluralStringResource(R.plurals.budgets_spent_across, categories, spent.text, categories)
    val spoken = pluralStringResource(R.plurals.budgets_spent_across, categories, spent.spoken, categories)
    LedgerCard(padding = PaddingValues(16.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(stringResource(R.string.budgets_no_target), style = MaterialTheme.typography.titleMedium)
            if (total.amount > 0) {
                Text(
                    sentence,
                    style = MaterialTheme.typography.bodyMedium.tabular(),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = if (spoken != sentence) Modifier.clearAndSetSemantics { contentDescription = spoken } else Modifier,
                )
            } else {
                Muted(stringResource(R.string.budgets_nothing_spent))
            }
        }
    }
}

/**
 * One category: its initials, the name, what is left or over (with how much is used) beside what was spent of the
 * budget, and a bar; with no budget set at all, its share of the month's spending instead. What rolled in or was
 * overspent before stays under the bar.
 */
@Composable
internal fun BudgetRow(line: BudgetLine, monthName: String, totalSpent: Long, targetSet: Boolean, onOpen: (() -> Unit)? = null) {
    val spent = money(line.spent.amount, line.spent.currency)
    val budget = line.budget
    val allowance = allowanceOf(line)
    val left = line.left
    val over = isOverspent(line)
    val pct = allowance?.let { percentUsed(line.spent.amount, it) }
    val noBudget = stringResource(R.string.budget_none)
    // The subtitle as shown, and as read aloud (an amount is "amount hidden" under privacy mode).
    val (shown, spoken) = when {
        budget != null && left != null -> {
            val amount = money(abs(left.amount), left.currency)
            @Composable fun words(text: String) = when {
                over && pct != null -> stringResource(R.string.budget_over_pct, text, pct)
                over -> stringResource(R.string.budget_over_plain, text)
                pct != null -> stringResource(R.string.budget_left_pct, text, pct)
                else -> stringResource(R.string.budget_left_plain, text)
            }
            words(amount.text) to words(amount.spoken)
        }
        targetSet -> noBudget to noBudget
        else -> (spendShare(line.spent.amount, totalSpent)?.let { stringResource(R.string.budget_share_of_spend, it, monthName) } ?: noBudget).let { it to it }
    }
    val of = budget?.let { money(it.amount.amount, it.amount.currency) }
    val carried = line.carriedIn.amount.takeIf { budget != null && it != 0L }?.let {
        val amount = money(abs(it), line.carriedIn.currency)
        val id = if (it > 0) R.string.budget_carried_over else R.string.budget_overspent
        stringResource(id, amount.text) to stringResource(id, amount.spoken)
    }
    val aloud = listOfNotNull(
        line.name, spoken, spent.spoken, of?.let { stringResource(R.string.budgets_of, it.spoken) }, carried?.second,
    ).joinToString(", ")
    val masked = spoken != shown || spent.spoken != spent.text
    // A category that can be budgeted opens its limit; an archived one cannot be.
    val open = onOpen.takeIf { !line.archived }
    val action = stringResource(if (budget == null) R.string.budget_set_limit_action else R.string.budget_edit_limit_action)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (open != null) Modifier.clickable(onClickLabel = action, role = Role.Button, onClick = open) else Modifier)
            .heightIn(min = RowHeight)
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .testTag("row-${line.name}")
            .then(if (masked) Modifier.clearAndSetSemantics { contentDescription = aloud } else Modifier),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Avatar(line.name)
            TitleAndAmount(
                title = {
                    Column {
                        Text(line.name, style = MaterialTheme.typography.titleMedium)
                        Text(
                            shown,
                            style = MaterialTheme.typography.bodySmall.tabular(),
                            color = if (over) LocalPalette.current.danger else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                amount = {
                    Column(horizontalAlignment = Alignment.End) {
                        Text(spent.text, style = MaterialTheme.typography.titleMedium.tabular(), maxLines = 1, softWrap = false)
                        if (of == null && open != null) {
                            Text(stringResource(R.string.budget_set_limit), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, maxLines = 1, softWrap = false)
                        }
                        if (of != null) {
                            Text(stringResource(R.string.budgets_of, of.text), style = MaterialTheme.typography.bodySmall.tabular(), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, softWrap = false, textAlign = TextAlign.End)
                        }
                    }
                },
                minTitle = 80.dp,
                modifier = Modifier.weight(1f),
            )
        }
        if (allowance != null) ProportionBar(shareOf(line.spent.amount, allowance), limitState(line.spent.amount, allowance))
        if (carried != null) Text(carried.first, style = MaterialTheme.typography.bodySmall.tabular(), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** One line for the categories with nothing planned or spent; it opens to their names. */
@Composable
private fun FoldedLine(folded: List<BudgetLine>, actions: LimitActions?) {
    var open by rememberSaveable { mutableStateOf(false) }
    LedgerCard(padding = PaddingValues(0.dp)) {
        Column {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = { open = !open }, role = Role.Button)
                    .heightIn(min = RowHeight)
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    pluralStringResource(R.plurals.budgets_folded, folded.size, folded.size),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                Icon(
                    painterResource(if (open) R.drawable.ic_chevron_down else R.drawable.ic_chevron_right),
                    contentDescription = null,
                    tint = LocalPalette.current.muted,
                )
            }
            if (open) {
                folded.forEach { line ->
                    val open = actions?.takeIf { !line.archived }?.let { a -> { a.open(line) } }
                    val action = stringResource(R.string.budget_set_limit_action)
                    Text(
                        line.name,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier
                            .fillMaxWidth()
                            .then(if (open != null) Modifier.clickable(onClickLabel = action, role = Role.Button, onClick = open) else Modifier)
                            .heightIn(min = 48.dp)
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                    )
                }
            }
        }
    }
}
