package app.ledgerline.android.ui.clients

import app.ledgerline.android.ui.editor.AmountInput
import app.ledgerline.android.ui.editor.amountText
import app.ledgerline.android.ui.editor.parseAmount
import app.ledgerline.api.CreateReceipt
import app.ledgerline.api.ExpectedAllocation
import app.ledgerline.api.Money
import app.ledgerline.api.ReceiptAllocation
import app.ledgerline.api.ReceiptPreview
import app.ledgerline.api.TipInput

/** Whom a payment is from, as the phone holds the client when the sheet opens: what they owe, in each currency. */
data class ReceiptTarget(
    val contactId: String,
    val clientName: String,
    /** What they owe per currency, in minor units; only amounts above zero. */
    val owed: List<Money>,
)

/** What is wrong with the form; each is said next to the field it belongs to. */
enum class ReceiptProblem {
    AmountMissing, AmountInvalid, AmountTooPrecise, AmountZero, AmountTooLarge,

    /** The account is in another currency and the amount that arrived in it is missing or not right. */
    ReceivedMissing, ReceivedInvalid, ReceivedTooPrecise, ReceivedZero, ReceivedTooLarge,

    /** A tip was typed (in the account's currency) and is not a valid amount above zero. */
    TipInvalid,

    /** Neither side is the base currency and what was typed for the rate cannot be stored. */
    RateInvalid,

    /** Neither side is the base currency, the ledger holds no rate for the date and none was typed. */
    RateMissing,

    /** The client owes nothing in the chosen currency. */
    NothingOwed,
    AccountMissing, CategoryMissing, TipCategoryMissing,

    /** Set by the sheet's logic, not by the form: the services this amount pays have not been read yet, or no longer match. */
    PreviewNotReady,
}

internal fun AmountIssue.receivedReceiptProblem() = when (this) {
    AmountIssue.Missing -> ReceiptProblem.ReceivedMissing
    AmountIssue.Invalid -> ReceiptProblem.ReceivedInvalid
    AmountIssue.TooPrecise -> ReceiptProblem.ReceivedTooPrecise
    AmountIssue.Zero -> ReceiptProblem.ReceivedZero
    AmountIssue.TooLarge -> ReceiptProblem.ReceivedTooLarge
}

/** What a preview pays: how many services in full, and whether the last one only in part. */
data class PaysSummary(val full: Int, val partial: Boolean)

fun paysSummary(allocations: List<ReceiptAllocation>) =
    PaysSummary(full = allocations.count { it.remainingAfter.amount == 0L }, partial = allocations.any { it.remainingAfter.amount > 0 })

/** The longest note the server takes. */
const val ReceiptNoteMax = 2_000

/**
 * The Record payment form for a client (ADR 0050, slice 4c; the prototype's `OV.receive`): one amount, applied to the
 * client's oldest unpaid services first, in one currency. Money over the open total settles everything and the rest is
 * one tip, as the web splits it. The request names the services of the preview that matches the amount shown, so a
 * service that changed meanwhile is refused by the server. An account in another currency (ADR 0050 slice 4b-1) also asks
 * for what arrived in it and takes an optional tip in its currency; the amount typed is then what settles, with no tip made
 * of the extra. When one side is the base currency the two amounts fix the rate and it is shown; when neither is (slice
 * 4b-2) the rate for the account's currency on the date is the one the ledger stores ([rateAnswer]) or one typed by hand
 * ([rateTyped]), which is the only case where a rate is sent.
 */
data class ReceiptForm(
    val target: ReceiptTarget,
    val currency: String,
    val amount: String,
    val accountId: String?,
    val categoryId: String?,
    val tipCategoryId: String?,
    val date: String,
    /** "HH:mm", or null when no time was set. */
    val time: String? = null,
    val note: String = "",
    /** The currency of the chosen account (null until one is chosen); another one than [currency] makes this a payment across currencies. */
    val accountCurrency: String? = null,
    /** What arrived in the account, typed, when its currency differs from [currency]. */
    val received: String = "",
    /** An optional tip in the account's currency, typed, when its currency differs from [currency]. */
    val tipAmount: String = "",
    /** A rate set by hand, base currency first ("122.5"), when neither side is the base currency; blank uses the stored one. */
    val rateTyped: String = "",
    /** What the last look-up of the stored rate found, with what it asked for; only used while it still matches [rateKey]. */
    val rateAnswer: RateAnswer? = null,
) {
    /** The rate to look up: the account's currency on the date, when neither side is the base currency. */
    val rateKey: RateKey? get() = accountCurrency?.takeIf { needsRate(currency, it) }?.let { RateKey(it, date) }

    /** The part that exists only when the account is in another currency than the one they owe in. */
    val cross: CrossCurrency? get() = accountCurrency?.takeIf { it != currency }?.let { account ->
        CrossCurrency(currency, account, received, tipAmount, rateTyped, rateKey?.let { rateAnswer.storedFor(it) } ?: StoredRate.Looking)
    }

    /** The currency the tip is in: the account's when it differs, else the currency they owe in. */
    val tipCurrency: String get() = cross?.accountCurrency ?: currency

    /** The rate the two amounts fix when the account is in another currency and one side is the base currency. */
    val rate: CrossRate? get() = cross?.rate(split?.settle)

    /** The form with another account chosen; what was typed is kept, except a rate typed for another account's currency. */
    fun withAccount(id: String?, currency: String?) =
        copy(accountId = id, accountCurrency = currency, rateTyped = if (currency == accountCurrency) rateTyped else "")

    private val parsed: AmountInput get() = parseAmount(amount, currency)

    /** What the client owes in [currency]. */
    val outstanding: Long get() = target.owed.firstOrNull { it.currency == currency }?.amount ?: 0

    /** What the amount settles and what is the tip, or null while the amount is not a valid one. */
    val split: Split? get() = (parsed as? AmountInput.Valid)?.let { if (cross != null) Split(it.minor, 0) else splitExtra(it.minor, outstanding) }

    /** The tip in minor units of [tipCurrency]: what was typed for an account in another currency, else the money over the open total. */
    val tipMinor: Long get() = cross?.tipMinor ?: (split?.tip ?: 0)

    /** What the server is asked to preview: the part that settles, never the tip; null while there is nothing to ask. */
    val previewAmount: Long? get() = split?.settle?.takeIf { it > 0 }

    /** The form with the amount set to everything the client owes in [currency]. */
    fun payInFull(): ReceiptForm = copy(amount = amountText(outstanding, currency))

    fun problems(): List<ReceiptProblem> = buildList {
        when (parsed) {
            AmountInput.Missing -> add(ReceiptProblem.AmountMissing)
            AmountInput.Invalid -> add(ReceiptProblem.AmountInvalid)
            AmountInput.TooPrecise -> add(ReceiptProblem.AmountTooPrecise)
            AmountInput.Zero -> add(ReceiptProblem.AmountZero)
            AmountInput.TooLarge -> add(ReceiptProblem.AmountTooLarge)
            is AmountInput.Valid -> Unit
        }
        cross?.let { c ->
            c.receivedIssue?.let { add(it.receivedReceiptProblem()) }
            if (c.tipIssue != null) add(ReceiptProblem.TipInvalid)
            if (c.rateTypedIssue) add(ReceiptProblem.RateInvalid)
            if (c.rateMissing) add(ReceiptProblem.RateMissing)
        }
        if (outstanding <= 0) add(ReceiptProblem.NothingOwed)
        if (accountId == null) add(ReceiptProblem.AccountMissing)
        if (categoryId == null) add(ReceiptProblem.CategoryMissing)
        if (split != null && tipMinor > 0 && tipCategoryId == null) add(ReceiptProblem.TipCategoryMissing)
    }

    /** Whether [preview] is the answer to this form's amount: the same client, amount and currency, with services to pay. */
    fun matches(preview: ReceiptPreview?): Boolean {
        val settle = previewAmount ?: return false
        return preview != null && preview.contactId == target.contactId && preview.amount == Money(settle, currency) &&
            !preview.exceedsBalance && !preview.tooManyServices && preview.allocations.isNotEmpty()
    }

    /** The body to send, or null while anything is wrong or [preview] is not the answer to this amount. */
    fun request(preview: ReceiptPreview?): CreateReceipt? {
        if (problems().isNotEmpty() || !matches(preview)) return null
        val split = split ?: return null
        return CreateReceipt(
            amount = Money(split.settle, currency),
            receivedAmount = cross?.receivedMinor?.let { Money(it, cross!!.accountCurrency) },
            fxRate = cross?.manualRate,
            accountId = accountId!!,
            categoryId = categoryId!!,
            date = date,
            time = time,
            note = note.trim().take(ReceiptNoteMax).ifEmpty { null },
            tip = if (tipMinor > 0) TipInput(Money(tipMinor, tipCurrency), tipCategoryId!!) else null,
            expectedAllocations = preview!!.allocations.map { ExpectedAllocation(it.receivableId, it.version, it.applied.amount) },
        )
    }

    companion object {
        /** The form for [target], in the first currency they owe in, with nothing typed or chosen. */
        fun forClient(target: ReceiptTarget, today: String) = ReceiptForm(
            target = target,
            currency = target.owed.firstOrNull()?.currency ?: "USD",
            amount = "",
            accountId = null,
            categoryId = null,
            tipCategoryId = null,
            date = today,
        )
    }
}
