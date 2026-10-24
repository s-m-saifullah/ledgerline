package app.ledgerline.android.ui.home

import app.ledgerline.android.mirror.AccountBalance
import app.ledgerline.android.ui.design.LimitState
import app.ledgerline.android.ui.design.limitState
import app.ledgerline.api.Money

/** This month's money in against money out (ADR 0046): the net, how much of the money in went out, and whether that is too much. */
data class CashFlow(val net: Money, val share: Float, val state: LimitState)

/** Null when the two figures are in different currencies (the server sends both in the base currency, so this should not happen). */
fun cashFlow(moneyIn: Money, moneyOut: Money): CashFlow? {
    if (moneyIn.currency != moneyOut.currency) return null
    val spentAnything = moneyOut.amount > 0
    return if (moneyIn.amount <= 0) {
        // Nothing came in: anything that went out is over, and an empty month is an empty bar.
        CashFlow(Money(moneyIn.amount - moneyOut.amount, moneyIn.currency), if (spentAnything) 1f else 0f, if (spentAnything) LimitState.Over else LimitState.Within)
    } else {
        CashFlow(
            Money(moneyIn.amount - moneyOut.amount, moneyIn.currency),
            (moneyOut.amount.toDouble() / moneyIn.amount).toFloat().coerceIn(0f, 1f),
            limitState(moneyOut.amount, moneyIn.amount),
        )
    }
}

/** Cards and loans are what the owner owes; everything else (bank, cash, wallet, savings, other) is money to hand. */
enum class AccountKind { Liquid, Debt }

fun accountKind(type: String): AccountKind = if (type == "card" || type == "loan") AccountKind.Debt else AccountKind.Liquid

data class AccountGroup(val kind: AccountKind, val items: List<AccountBalance>)

/** The accounts of [currency] (all when null) in two groups, money to hand first; a group with nothing in it is left out. */
fun groupAccounts(items: List<AccountBalance>, currency: String?): List<AccountGroup> {
    val shown = items.filter { currency == null || it.currency == currency }
    return AccountKind.entries.mapNotNull { kind -> shown.filter { accountKind(it.type) == kind }.takeIf { it.isNotEmpty() }?.let { AccountGroup(kind, it) } }
}

/** The currencies of [items], the one with most accounts first; the currency control shows only with two or more. */
fun currenciesOf(items: List<AccountBalance>): List<String> =
    items.groupingBy { it.currency }.eachCount().entries.sortedWith(compareBy({ -it.value }, { it.key })).map { it.key }
