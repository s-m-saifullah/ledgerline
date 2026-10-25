package app.ledgerline.android.ui.budgets

import app.ledgerline.api.BudgetLine
import java.time.LocalDate
import java.time.YearMonth
import java.util.Locale

/** What the Budgets list shows ([active], ranked) and what it folds into one line ([folded]). */
data class LineGroups(val active: List<BudgetLine>, val folded: List<BudgetLine>)

/** Over what the category had to spend, which is its budget plus what rolled in. */
fun isOverspent(line: BudgetLine): Boolean = (line.left?.amount ?: 0L) < 0

/** What a budgeted category has to spend this month: its budget plus what it carried in. */
fun allowanceOf(line: BudgetLine): Long? = line.budget?.let { it.amount.amount + line.carriedIn.amount }

/**
 * Overspent categories first, then the rest, each by what was spent (the biggest first; equal ones keep the server's
 * order). A category with a budget stays listed even with nothing spent; only one with no budget and nothing spent
 * is folded away (ADR 0046).
 */
fun splitLines(items: List<BudgetLine>): LineGroups {
    val (folded, active) = items.partition { it.budget == null && it.spent.amount <= 0 }
    return LineGroups(active.sortedWith(compareBy<BudgetLine>({ if (isOverspent(it)) 0 else 1 }, { -it.spent.amount })), folded)
}

/** How much of [allowance] [spent] is, as a whole percent (it can pass 100); null without an allowance to compare to. */
fun percentUsed(spent: Long, allowance: Long): Int? =
    if (allowance <= 0) null else Math.round(spent * 100.0 / allowance).toInt()

/** The days left in [month] after [today], only while [today] is in that month (and not on its last day). */
fun daysLeft(month: YearMonth, today: LocalDate): Int? =
    if (YearMonth.from(today) != month) null else (month.lengthOfMonth() - today.dayOfMonth).takeIf { it > 0 }

/** [spent] as a share of the month's [total], with one decimal ("41.9"); null when nothing was spent in all. */
fun spendShare(spent: Long, total: Long): String? =
    if (total <= 0) null else String.format(Locale.getDefault(), "%.1f", spent * 100.0 / total)

/** Everything spent in the month, with a budget or without. */
fun totalSpent(items: List<BudgetLine>): Long = items.sumOf { it.spent.amount }

/** How full a bar is, between 0 and 1: all of it when there is no allowance but something was spent. */
fun shareOf(spent: Long, allowance: Long): Float {
    if (allowance <= 0) return if (spent > 0) 1f else 0f
    return (spent.toDouble() / allowance).coerceIn(0.0, 1.0).toFloat()
}
