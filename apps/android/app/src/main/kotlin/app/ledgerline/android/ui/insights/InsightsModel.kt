package app.ledgerline.android.ui.insights

import app.ledgerline.android.mirror.AccountBalance
import app.ledgerline.android.ui.home.AccountKind
import app.ledgerline.android.ui.home.accountKind
import app.ledgerline.api.CashFlowMonth
import app.ledgerline.api.CashFlowReport
import app.ledgerline.api.Money

/**
 * What the owner has and owes today (ADR 0046): money to hand, what is owed on cards and loans (a negative figure,
 * as a balance), and the two together. Worked out on the phone from the mirrored account balances, so it needs no
 * server change; the chart below it comes from the server and follows the month.
 */
data class WorthSnapshot(val assets: Money, val liabilities: Money, val net: Money)

/**
 * The snapshot of [accounts], archived ones included as the server's net worth counts them. Null with no accounts,
 * and null when they are in more than one currency: adding them needs exchange rates, which only the server has,
 * and a figure that does not match the chart would be worse than none.
 */
fun worthSnapshot(accounts: List<AccountBalance>): WorthSnapshot? {
    val currency = accounts.map { it.currency }.distinct().singleOrNull() ?: return null
    val assets = accounts.filter { accountKind(it.type) == AccountKind.Liquid }.sumOf { it.balance }
    val liabilities = accounts.filter { accountKind(it.type) == AccountKind.Debt }.sumOf { it.balance }
    return WorthSnapshot(Money(assets, currency), Money(liabilities, currency), Money(assets + liabilities, currency))
}

/** A month with money in or spending; the 12-month chart and its figures are for months like this. */
fun hasActivity(month: CashFlowMonth): Boolean = month.income.amount > 0 || month.spending.amount > 0

/** The 12-month chart shows only when two or more months have activity: one month is already the summary card. */
fun showCashFlow(report: CashFlowReport): Boolean = report.months.count(::hasActivity) >= 2

/** How a net worth bar is drawn: the accent when there is money, the neutral colour below zero (never a tall green bar). */
enum class WorthTone { Positive, Negative }

fun worthTone(cents: Long): WorthTone = if (cents < 0) WorthTone.Negative else WorthTone.Positive

/** The summary card's bar: nothing without money in, spent against kept, or all red when more went out than came in. */
sealed interface SummaryBar {
    data object None : SummaryBar

    /** [spent] is the share of the money in that went out, 0 to 1; the rest was kept. */
    data class Split(val spent: Float) : SummaryBar

    data object Over : SummaryBar
}

fun summaryBar(income: Long, spent: Long): SummaryBar = when {
    income <= 0 -> SummaryBar.None
    spent > income -> SummaryBar.Over
    else -> SummaryBar.Split(spent.toFloat() / income)
}
