package app.ledgerline.android.ui.clients

import app.ledgerline.android.ui.editor.AmountInput
import app.ledgerline.android.ui.editor.deriveRate
import app.ledgerline.android.ui.editor.parseAmount
import app.ledgerline.android.ui.editor.rateSentence

/** The base currency of every ledger today (the web's `USD` everywhere it converts). */
const val BaseCurrency = "USD"

/**
 * Whether the phone can take a payment for a service in [itemCurrency] into an account in [accountCurrency] (ADR 0050,
 * slice 4b-1): the same currency, or one side is the base currency, where the two amounts fix the rate. An account where
 * neither side is the base currency needs a rate looked up or set by hand, which comes with the next slice.
 */
fun usableAccount(itemCurrency: String, accountCurrency: String): Boolean =
    accountCurrency == itemCurrency || accountCurrency == BaseCurrency || itemCurrency == BaseCurrency

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
data class CrossCurrency(val itemCurrency: String, val accountCurrency: String, val received: String, val tip: String) {
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

    /**
     * The rate the two amounts fix when one side is the base currency, or null when either amount is not valid yet (or
     * neither side is the base currency, which the phone does not take in this slice).
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
