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

    /** The client owes nothing in the chosen currency. */
    NothingOwed,
    AccountMissing, CategoryMissing, TipCategoryMissing,

    /** Set by the sheet's logic, not by the form: the services this amount pays have not been read yet, or no longer match. */
    PreviewNotReady,
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
 * service that changed meanwhile is refused by the server. An account in another currency comes with the next slice, so
 * the account is always in [currency] here.
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
) {
    private val parsed: AmountInput get() = parseAmount(amount, currency)

    /** What the client owes in [currency]. */
    val outstanding: Long get() = target.owed.firstOrNull { it.currency == currency }?.amount ?: 0

    /** What the amount settles and what is the tip, or null while the amount is not a valid one. */
    val split: Split? get() = (parsed as? AmountInput.Valid)?.let { splitExtra(it.minor, outstanding) }

    /** The tip in minor units: zero when the amount is not over the open total or is not valid yet. */
    val tipMinor: Long get() = split?.tip ?: 0

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
            accountId = accountId!!,
            categoryId = categoryId!!,
            date = date,
            time = time,
            note = note.trim().take(ReceiptNoteMax).ifEmpty { null },
            tip = if (split.tip > 0) TipInput(Money(split.tip, currency), tipCategoryId!!) else null,
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
