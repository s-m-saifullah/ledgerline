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
enum class PaymentProblem {
    AmountMissing, AmountInvalid, AmountTooPrecise, AmountZero, AmountTooLarge,

    /** The account is in another currency and the amount that arrived in it is missing or not right. */
    ReceivedMissing, ReceivedInvalid, ReceivedTooPrecise, ReceivedZero, ReceivedTooLarge,

    /** A tip was typed (in the account's currency) and is not a valid amount above zero. */
    TipInvalid,
    AccountMissing, CategoryMissing, TipCategoryMissing,
}

internal fun AmountIssue.receivedProblem() = when (this) {
    AmountIssue.Missing -> PaymentProblem.ReceivedMissing
    AmountIssue.Invalid -> PaymentProblem.ReceivedInvalid
    AmountIssue.TooPrecise -> PaymentProblem.ReceivedTooPrecise
    AmountIssue.Zero -> PaymentProblem.ReceivedZero
    AmountIssue.TooLarge -> PaymentProblem.ReceivedTooLarge
}

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
 * categories are the only things to choose. An account in another currency (one side the base currency, ADR 0050 slice
 * 4b-1) also asks for what arrived in it, shows the rate the two amounts fix and takes an optional tip in its currency.
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
    /** The currency of the chosen account (null until one is chosen); another one than the service's makes this a payment across currencies. */
    val accountCurrency: String? = null,
    /** What arrived in the account, typed, when its currency differs from the service's. */
    val received: String = "",
    /** An optional tip in the account's currency, typed, when its currency differs from the service's. */
    val tipAmount: String = "",
) {
    /** The part that exists only when the account is in another currency than the service. */
    val cross: CrossCurrency? get() = accountCurrency?.takeIf { it != target.currency }?.let { CrossCurrency(target.currency, it, received, tipAmount) }

    /** The currency the tip is in: the account's when it differs from the service's, else the service's. */
    val tipCurrency: String get() = cross?.accountCurrency ?: target.currency

    /** The rate the two amounts fix when the account is in another currency and one side is the base currency. */
    val rate: CrossRate? get() = cross?.rate(split?.settle)

    /** The form with another account chosen; what was typed is kept. */
    fun withAccount(id: String?, currency: String?) = copy(accountId = id, accountCurrency = currency)

    private val parsed: AmountInput get() = parseAmount(amount, target.currency)

    /** What the amount settles and what is the tip, or null while the amount is not a valid one. */
    val split: Split? get() = (parsed as? AmountInput.Valid)?.let { if (cross != null) Split(it.minor, 0) else splitExtra(it.minor, target.outstanding) }

    /**
     * The tip in minor units of [tipCurrency]: with an account in another currency what was typed for it (the amount over
     * what is outstanding is not turned into a tip there, the server refuses it), else the money over what is outstanding.
     */
    val tipMinor: Long get() = cross?.tipMinor ?: (split?.tip ?: 0)

    fun problems(): List<PaymentProblem> = buildList {
        when (parsed) {
            AmountInput.Missing -> add(PaymentProblem.AmountMissing)
            AmountInput.Invalid -> add(PaymentProblem.AmountInvalid)
            AmountInput.TooPrecise -> add(PaymentProblem.AmountTooPrecise)
            AmountInput.Zero -> add(PaymentProblem.AmountZero)
            AmountInput.TooLarge -> add(PaymentProblem.AmountTooLarge)
            is AmountInput.Valid -> Unit
        }
        cross?.let { c ->
            c.receivedIssue?.let { add(it.receivedProblem()) }
            if (c.tipIssue != null) add(PaymentProblem.TipInvalid)
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
            receivedAmount = cross?.receivedMinor?.let { Money(it, cross!!.accountCurrency) },
            accountId = accountId!!,
            categoryId = categoryId!!,
            date = date,
            time = time,
            note = note.trim().take(PaymentNoteMax).ifEmpty { null },
            tip = if (tipMinor > 0) TipInput(Money(tipMinor, tipCurrency), tipCategoryId!!) else null,
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
