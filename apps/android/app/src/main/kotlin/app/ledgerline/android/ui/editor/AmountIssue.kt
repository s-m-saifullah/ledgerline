package app.ledgerline.android.ui.editor

import app.ledgerline.android.R

/** What is wrong with a typed amount; each form says it next to its own field. */
enum class AmountIssue { Missing, Invalid, TooPrecise, Zero, TooLarge }

/** The one place a typed amount's result is turned into what is wrong with it; null for a valid amount. */
internal fun AmountInput.issue(): AmountIssue? = when (this) {
    AmountInput.Missing -> AmountIssue.Missing
    AmountInput.Invalid -> AmountIssue.Invalid
    AmountInput.TooPrecise -> AmountIssue.TooPrecise
    AmountInput.Zero -> AmountIssue.Zero
    AmountInput.TooLarge -> AmountIssue.TooLarge
    is AmountInput.Valid -> null
}

/**
 * A form's own problem for an amount: every form's problem enum names the five `Amount` + the issue (`AmountMissing`,
 * `AmountInvalid`, `AmountTooPrecise`, `AmountZero`, `AmountTooLarge`), so one function serves them all.
 * `AmountIssueTest` fails when a form's enum lacks one.
 */
internal inline fun <reified E : Enum<E>> AmountIssue.amountProblem(): E = enumValueOf("Amount$name")

/** The same, for what was typed: null while the amount is valid. */
internal inline fun <reified E : Enum<E>> AmountInput.amountProblem(): E? = issue()?.amountProblem()

/** The words for each issue, the same on every screen. */
internal fun AmountIssue.messageRes() = when (this) {
    AmountIssue.Missing -> R.string.editor_error_amount_missing
    AmountIssue.Invalid -> R.string.editor_error_amount_invalid
    AmountIssue.TooPrecise -> R.string.editor_error_amount_precise
    AmountIssue.Zero -> R.string.editor_error_amount_zero
    AmountIssue.TooLarge -> R.string.editor_error_amount_large
}
