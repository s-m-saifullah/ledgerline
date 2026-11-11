package app.ledgerline.android.ui.clients

import app.ledgerline.android.ui.editor.AmountInput
import app.ledgerline.android.ui.editor.convertMinor
import app.ledgerline.android.ui.editor.deriveRate
import app.ledgerline.android.ui.editor.parseAmount
import app.ledgerline.android.ui.editor.rateFromTyped
import app.ledgerline.android.ui.editor.rateSentence

/** The base currency of every ledger today (the web's `USD` everywhere it converts). */
const val BaseCurrency = "USD"

/**
 * The web's `rateSettable` (ADR 0050, slice 4b-2): the currencies differ and neither is the base currency, so the entry's
 * value in the base currency comes from a rate that is stored or set by hand. Every open account can take a payment: in the
 * same currency nothing more is asked, and when one side is the base currency the two amounts fix the rate.
 */
fun needsRate(itemCurrency: String, accountCurrency: String): Boolean =
    itemCurrency != accountCurrency && itemCurrency != BaseCurrency && accountCurrency != BaseCurrency

/** The rate asked for: the account's currency on the payment's date. */
data class RateKey(val code: String, val date: String)

/** What the ledger holds for a [RateKey]. */
sealed interface StoredRate {
    /** Not answered yet. */
    data object Looking : StoredRate

    /** The look-up failed (offline, or an error); the server still decides when the payment is saved. */
    data object Unavailable : StoredRate

    /** The ledger holds no rate for that currency on or before the date, so a payment cannot be saved without one set by hand. */
    data object Missing : StoredRate

    /** The newest stored rate on or before the date: [rate] is base units per unit, [rateDate] the day it is from. */
    data class Found(val rate: String, val rateDate: String?) : StoredRate
}

/** A look-up's answer with what it was asked for, so one for another account or date is never used. */
data class RateAnswer(val key: RateKey, val stored: StoredRate) {
    fun storedFor(wanted: RateKey): StoredRate = if (key == wanted) stored else StoredRate.Looking
}

internal fun RateAnswer?.storedFor(wanted: RateKey): StoredRate = this?.storedFor(wanted) ?: StoredRate.Looking

/** What is wrong with a typed amount; each form says it next to its own field. */
enum class AmountIssue { Missing, Invalid, TooPrecise, Zero, TooLarge }

internal fun AmountInput.issue(): AmountIssue? = when (this) {
    AmountInput.Missing -> AmountIssue.Missing
    AmountInput.Invalid -> AmountIssue.Invalid
    AmountInput.TooPrecise -> AmountIssue.TooPrecise
    AmountInput.Zero -> AmountIssue.Zero
    AmountInput.TooLarge -> AmountIssue.TooLarge
    is AmountInput.Valid -> null
}

/** The rate two amounts fix, with the currency it is for: shown as "1 USD = 0.92 EUR" so a typo in the amount received stands out. */
data class CrossRate(val foreign: String, val rate: String) {
    val sentence: String get() = rateSentence(foreign, rate, BaseCurrency)
}

/**
 * What an account in another currency adds to a payment (the web's `needsReceived`): the amount that arrived in the
 * account's currency, and an optional tip in that same currency. The money settled stays in the service's currency.
 */
data class CrossCurrency(
    val itemCurrency: String,
    val accountCurrency: String,
    val received: String,
    val tip: String,
    /** The rate typed by hand, base currency first ("122.5" for 1 USD = 122.5 GBP); blank means use the stored one. */
    val rateTyped: String = "",
    /** What the ledger holds for the account's currency on the payment's date. */
    val stored: StoredRate = StoredRate.Looking,
) {
    private val receivedInput: AmountInput get() = parseAmount(received, accountCurrency)
    private val tipInput: AmountInput get() = parseAmount(tip, accountCurrency)

    /** What arrived, in minor units of the account's currency, or null while the amount is not a valid one. */
    val receivedMinor: Long? get() = (receivedInput as? AmountInput.Valid)?.minor

    /** What is wrong with the amount received (a blank one included), or null. */
    val receivedIssue: AmountIssue? get() = receivedInput.issue()

    /** The tip in minor units of the account's currency; zero when it is blank or not valid. */
    val tipMinor: Long get() = (tipInput as? AmountInput.Valid)?.minor ?: 0

    /** A tip may be left blank, but one that is typed has to be a valid amount above zero. */
    val tipIssue: AmountIssue? get() = if (tip.isBlank()) null else tipInput.issue()

    /** Neither side is the base currency, so the entry's value in it comes from a rate (the web's `rateSettable`). */
    val needsRate: Boolean get() = needsRate(itemCurrency, accountCurrency)

    /** The rate typed by hand as it is stored (base units per unit of the account's currency), or null. */
    val manualRate: String? get() = if (needsRate) rateFromTyped(rateTyped) else null

    /** Something was typed for the rate that cannot be stored; saving waits until it is fixed or cleared. */
    val rateTypedIssue: Boolean get() = needsRate && rateTyped.isNotBlank() && manualRate == null

    /** The rate the entry would be valued at: the one typed, else the stored one; null when there is none to use. */
    val rateInUse: String? get() = if (!needsRate) null else manualRate ?: (stored as? StoredRate.Found)?.rate

    /** The ledger holds no rate for this date and none was typed: the server would refuse, so the phone does not ask. */
    val rateMissing: Boolean get() = needsRate && rateTyped.isBlank() && stored is StoredRate.Missing

    /** What arrived, worth this much in the base currency (minor units) at [rateInUse], or null while either is not there. */
    fun baseValue(): Long? {
        val rate = rateInUse ?: return null
        val arrived = receivedMinor ?: return null
        return try {
            convertMinor(arrived, rate, accountCurrency, BaseCurrency)
        } catch (_: ArithmeticException) {
            null
        }
    }

    /**
     * The rate the two amounts fix when one side is the base currency, or null when either amount is not valid yet (or
     * neither side is the base currency: there a rate is stored or typed instead, see [rateInUse]).
     */
    fun rate(settled: Long?): CrossRate? {
        val arrived = receivedMinor ?: return null
        if (settled == null || settled <= 0) return null
        return when {
            itemCurrency == BaseCurrency -> CrossRate(accountCurrency, deriveRate(settled, arrived, accountCurrency, BaseCurrency))
            accountCurrency == BaseCurrency -> CrossRate(itemCurrency, deriveRate(arrived, settled, itemCurrency, BaseCurrency))
            else -> null
        }
    }
}
