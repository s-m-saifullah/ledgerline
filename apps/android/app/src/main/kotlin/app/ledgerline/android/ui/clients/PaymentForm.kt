package app.ledgerline.android.ui.clients

import app.ledgerline.android.ui.editor.AmountInput
import app.ledgerline.android.ui.editor.amountText
import app.ledgerline.android.ui.editor.parseAmount
import app.ledgerline.api.CreatePayment
import app.ledgerline.api.Money
import app.ledgerline.api.TipInput

/** What a payment is for: one service of one client, as the phone holds it when the sheet opens. */
data class PaymentTarget(
    val serviceId: String,
    /** The version of the service the phone holds; the server refuses the payment if the service moved on. */
    val serviceVersion: Int,
    val description: String,
    val clientName: String,
    val currency: String,
    /** What is still owed, in minor units of [currency]. */
    val outstanding: Long,
)

/** What is wrong with the form; each is said next to the field it belongs to. */
enum class PaymentProblem { AmountMissing, AmountInvalid, AmountTooPrecise, AmountZero, AmountTooLarge, AccountMissing, CategoryMissing, TipCategoryMissing }

/** What a payment settles and what is left over as a tip, in minor units. */
data class Split(val settle: Long, val tip: Long)

/** Money over what is outstanding settles the balance and the rest is a tip (ADR 0027), as the web splits it. */
fun splitExtra(amount: Long, outstanding: Long): Split =
    if (amount > outstanding) Split(settle = outstanding, tip = amount - outstanding) else Split(settle = amount, tip = 0)

/** The longest note the server takes. */
const val PaymentNoteMax = 2_000

/**
 * The Record payment form (ADR 0050, the prototype's `OV["pay-service"]`): the amount starts at what is outstanding, so
 * recording the full payment, which is also marking the service paid, is one confirmation away. The account and the
 * categories are the only things to choose. A payment in another currency comes with the next slice, so the account is
 * always in the service's currency here.
 */
data class PaymentForm(
    val target: PaymentTarget,
    val amount: String,
    val accountId: String?,
    val categoryId: String?,
    val tipCategoryId: String?,
    val date: String,
    /** "HH:mm", or null when no time was set. */
    val time: String? = null,
    val note: String = "",
) {
    private val parsed: AmountInput get() = parseAmount(amount, target.currency)

    /** What the amount settles and what is the tip, or null while the amount is not a valid one. */
    val split: Split? get() = (parsed as? AmountInput.Valid)?.let { splitExtra(it.minor, target.outstanding) }

    /** The tip in minor units: zero when the amount is not over what is outstanding or is not valid yet. */
    val tipMinor: Long get() = split?.tip ?: 0

    fun problems(): List<PaymentProblem> = buildList {
        when (parsed) {
            AmountInput.Missing -> add(PaymentProblem.AmountMissing)
            AmountInput.Invalid -> add(PaymentProblem.AmountInvalid)
            AmountInput.TooPrecise -> add(PaymentProblem.AmountTooPrecise)
            AmountInput.Zero -> add(PaymentProblem.AmountZero)
            AmountInput.TooLarge -> add(PaymentProblem.AmountTooLarge)
            is AmountInput.Valid -> Unit
        }
        if (accountId == null) add(PaymentProblem.AccountMissing)
        if (categoryId == null) add(PaymentProblem.CategoryMissing)
        if (split != null && tipMinor > 0 && tipCategoryId == null) add(PaymentProblem.TipCategoryMissing)
    }

    /** The body to send, or null while anything is wrong. Optional parts that were not given are left out. */
    fun request(): CreatePayment? {
        if (problems().isNotEmpty()) return null
        val split = split ?: return null
        return CreatePayment(
            amount = Money(split.settle, target.currency),
            accountId = accountId!!,
            categoryId = categoryId!!,
            date = date,
            time = time,
            note = note.trim().take(PaymentNoteMax).ifEmpty { null },
            tip = if (split.tip > 0) TipInput(Money(split.tip, target.currency), tipCategoryId!!) else null,
            expectedReceivableVersion = target.serviceVersion,
        )
    }

    companion object {
        fun forService(target: PaymentTarget, today: String) = PaymentForm(
            target = target,
            amount = amountText(target.outstanding, target.currency),
            accountId = null,
            categoryId = null,
            tipCategoryId = null,
            date = today,
        )
    }
}
