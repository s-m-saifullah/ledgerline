package app.ledgerline.android.ui.budgets

import app.ledgerline.android.online.Written
import app.ledgerline.android.ui.editor.AmountInput
import app.ledgerline.android.ui.editor.amountText
import app.ledgerline.android.ui.editor.currencyDigits
import app.ledgerline.android.ui.editor.parseAmount
import app.ledgerline.api.Budget
import app.ledgerline.api.BudgetLine
import app.ledgerline.api.Money
import app.ledgerline.api.SetBudget

/** What a limit is for: one category's month, with what was spent in it and the limit it has, if any. */
data class LimitTarget(
    val categoryId: String,
    val name: String,
    val month: String,
    val currency: String,
    val spent: Long,
    val budget: Budget?,
)

/**
 * The Set limit sheet's form (ADR 0046): one amount, checked as the editor checks amounts (exact, in the currency's
 * decimals, above zero). An edit keeps what the web chose for carrying over and sends the version it holds.
 */
data class LimitForm(val target: LimitTarget, val text: String) {
    val editing: Boolean get() = target.budget != null
    val parsed: AmountInput get() = parseAmount(text, target.currency)
    val minor: Long? get() = (parsed as? AmountInput.Valid)?.minor

    /** A valid amount that is not the limit it already has. */
    val canSave: Boolean get() = minor != null && minor != target.budget?.amount?.amount

    fun request(): SetBudget? = minor?.let {
        SetBudget(
            categoryId = target.categoryId,
            month = target.month,
            amount = Money(it, target.currency),
            rollover = target.budget?.rollover ?: false,
            expectedVersion = target.budget?.version,
        )
    }

    companion object {
        /** The form for [line] in [month]; null for an archived category, which the server will not budget. */
        fun forLine(line: BudgetLine, month: String): LimitForm? {
            if (line.archived) return null
            val target = LimitTarget(line.categoryId, line.name, month, line.spent.currency, line.spent.amount, line.budget)
            return LimitForm(target, line.budget?.let { amountText(it.amount.amount, it.amount.currency) }.orEmpty())
        }
    }
}

/** The four presets under the amount box, in minor units of [currency]: 50, 100, 150 and 250. */
fun limitPresets(currency: String): List<Long> {
    var unit = 1L
    repeat(currency.let(::currencyDigits)) { unit *= 10 }
    return listOf(50L, 100L, 150L, 250L).map { it * unit }
}

/** Why a limit could not be saved. */
sealed interface LimitError {
    data object Offline : LimitError

    data object Forbidden : LimitError

    data object Failed : LimitError

    /** The server's own sentence (a version that moved on, a category that cannot be budgeted); null when it gave none. */
    data class Rejected(val detail: String?) : LimitError
}

internal fun Written<*>.toLimitError(): LimitError? = when (this) {
    is Written.Done -> null
    Written.Offline -> LimitError.Offline
    Written.Forbidden -> LimitError.Forbidden
    Written.Failed -> LimitError.Failed
    is Written.Rejected -> LimitError.Rejected(detail)
}

/** The sheet as the screen sees it: the form, whether a write is in flight, how the last one ended, and whether Remove is being asked. */
data class LimitUi(val form: LimitForm, val saving: Boolean = false, val error: LimitError? = null, val askRemove: Boolean = false)
