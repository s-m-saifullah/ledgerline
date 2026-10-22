package app.ledgerline.android.ui.editor

import java.math.BigDecimal
import java.util.Currency

sealed interface AmountInput {
    data class Valid(val minor: Long) : AmountInput
    data object Missing : AmountInput
    data object Invalid : AmountInput
    data object TooPrecise : AmountInput
    data object Zero : AmountInput
    data object TooLarge : AmountInput
}

/** The largest amount the server stores exactly (2^53 - 1 minor units). */
const val MaxMinor = 9_007_199_254_740_991L

/** The currency's own number of decimals (from ICU's CLDR data on Android, as the server's `Intl` uses). */
fun currencyDigits(code: String): Int = try {
    Currency.getInstance(code).defaultFractionDigits.takeIf { it >= 0 } ?: 2
} catch (_: IllegalArgumentException) {
    2
}

/**
 * Turns what the owner typed into minor units, exactly: through BigDecimal, never floating point. A positive number
 * with one decimal separator ("." or ","), and no more decimals than the currency has; a typed amount is never
 * rounded. The sign comes from the kind of entry, not from the text.
 */
fun parseAmount(text: String, currency: String): AmountInput {
    val cleaned = text.trim().replace(" ", "").replace(" ", "")
    if (cleaned.isEmpty()) return AmountInput.Missing
    if (!Regex("^[0-9]*([.,][0-9]*)?$").matches(cleaned) || cleaned == "." || cleaned == ",") return AmountInput.Invalid
    val value = BigDecimal(cleaned.replace(',', '.').let { if (it.startsWith(".")) "0$it" else it }.trimEnd('.'))
    if (value.signum() == 0) return AmountInput.Zero
    val minor = value.movePointRight(currencyDigits(currency))
    if (minor.stripTrailingZeros().scale() > 0) return AmountInput.TooPrecise
    if (minor > BigDecimal.valueOf(MaxMinor)) return AmountInput.TooLarge
    return AmountInput.Valid(minor.longValueExact())
}

/** Minor units back to text for the amount field ("12.50"), in the currency's decimals. */
fun amountText(minor: Long, currency: String): String =
    BigDecimal.valueOf(minor, currencyDigits(currency)).abs().toPlainString()
