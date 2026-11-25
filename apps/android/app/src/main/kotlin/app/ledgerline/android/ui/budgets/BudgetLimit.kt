package app.ledgerline.android.ui.budgets

import app.ledgerline.android.online.WriteError
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

/** What is wrong with the typed limit, in the web's words where the web has them (`limit-sheet.tsx`). */
enum class LimitProblem { Missing, Negative, Invalid, TooPrecise, TooLarge }

/**
 * The Set limit sheet's form (ADR 0046): one amount, read as the editor reads amounts (exact, in the currency's
 * decimals) but, as on the web and the server, zero is a limit; and the carry-over switch, which starts where the
 * saved limit has it. An edit sends the version it holds.
 */
data class LimitForm(val target: LimitTarget, val text: String, val rollover: Boolean = false) {
    val editing: Boolean get() = target.budget != null
    val parsed: AmountInput get() = parseAmount(text, target.currency)
    val minor: Long? get() = when (val p = parsed) {
        is AmountInput.Valid -> p.minor
        AmountInput.Zero -> 0L
        else -> null
    }

    /** What is wrong with the amount, or null while it is a limit. */
    val problem: LimitProblem? get() = when (parsed) {
        AmountInput.Missing -> LimitProblem.Missing
        AmountInput.Invalid -> if (isNegative()) LimitProblem.Negative else LimitProblem.Invalid
        AmountInput.TooPrecise -> LimitProblem.TooPrecise
        AmountInput.TooLarge -> LimitProblem.TooLarge
        AmountInput.Zero, is AmountInput.Valid -> null
    }

    /** A minus sign before an amount that would otherwise be fine (the web's "A budget cannot be negative."). */
    private fun isNegative() = text.trim().startsWith("-") && parseAmount(text.trim().drop(1), target.currency).let { it is AmountInput.Valid || it == AmountInput.Zero }

    /** A valid amount, or the switch, that is not what the limit already has; a new limit needs an amount. */
    val canSave: Boolean
        get() = minor != null && (minor != target.budget?.amount?.amount || rollover != (target.budget?.rollover ?: false))

    fun request(): SetBudget? = minor?.let {
        SetBudget(
            categoryId = target.categoryId,
            month = target.month,
            amount = Money(it, target.currency),
            rollover = rollover,
            expectedVersion = target.budget?.version,
        )
    }

    companion object {
        /** The form for [line] in [month]; null for an archived category, which the server will not budget. */
        fun forLine(line: BudgetLine, month: String): LimitForm? {
            if (line.archived) return null
            val target = LimitTarget(line.categoryId, line.name, month, line.spent.currency, line.spent.amount, line.budget)
            return LimitForm(target, line.budget?.let { amountText(it.amount.amount, it.amount.currency) }.orEmpty(), line.budget?.rollover ?: false)
        }
    }
}

/** The four presets under the amount box, in minor units of [currency]: 50, 100, 150 and 250. */
fun limitPresets(currency: String): List<Long> {
    var unit = 1L
    repeat(currency.let(::currencyDigits)) { unit *= 10 }
    return listOf(50L, 100L, 150L, 250L).map { it * unit }
}

/** The sheet as the screen sees it: the form, whether a write is in flight, how the last one ended, and whether Remove is being asked. */
data class LimitUi(val form: LimitForm, val saving: Boolean = false, val error: WriteError? = null, val askRemove: Boolean = false)
