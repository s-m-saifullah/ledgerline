package app.ledgerline.android.ui.clients

import app.ledgerline.android.ui.editor.AmountInput
import app.ledgerline.android.ui.editor.MaxMinor
import app.ledgerline.android.ui.editor.parseAmount
import java.math.BigInteger

/*
 * The hourly helper on Log service (ADR 0026): hours at a rate come to a total, which only fills the amount. The two
 * functions are ports of `hoursToHundredths` and `hourlyTotal` in `packages/shared/src/receivables.ts`, checked against the
 * web's own answers (`hourly-parity.json`); the money is never a float.
 */

private val HoursPattern = Regex("^(\\d{1,4})(?:\\.(\\d{1,2}))?$")

/** Hours typed as a decimal with at most two places ("3.5", "0.25") as whole hundredths of an hour; null when invalid. */
fun hoursToHundredths(text: String): Int? {
    val match = HoursPattern.matchEntire(text.trim()) ?: return null
    val hundredths = match.groupValues[1].toInt() * 100 + match.groupValues[2].padEnd(2, '0').toInt()
    return hundredths.takeIf { it >= 1 }
}

/** What a person types for hours: the web's reader, but ".5", "2." and "1,5" are accepted as meant (a typed field is not strict). */
fun hoursFromTyped(text: String): Int? {
    val cleaned = text.trim().replace(',', '.')
    if (cleaned == ".") return null
    return hoursToHundredths(cleaned.let { if (it.startsWith(".")) "0$it" else it }.trimEnd('.'))
}

/**
 * What hourly work comes to: the rate in minor units for one hour times the hours in hundredths, rounded half up to the
 * smallest unit; null when the total is beyond the safe money range.
 */
fun hourlyTotal(rate: Long, hundredths: Long): Long? {
    val total = (BigInteger.valueOf(rate) * BigInteger.valueOf(hundredths) + BigInteger.valueOf(50)) / BigInteger.valueOf(100)
    return total.takeIf { it <= BigInteger.valueOf(MaxMinor) }?.toLong()
}

/** What is wrong with the two boxes. */
enum class HourlyProblem { Hours, Rate, Range }

/** What the two boxes say: a total with how it was worked out, or what is wrong. */
sealed interface HourlyResult {
    /** [hours] without trailing zeros ("3.5") and [rate] in minor units of the currency. */
    data class Total(val total: Long, val hours: String, val rate: Long) : HourlyResult
    data class Wrong(val problem: HourlyProblem) : HourlyResult
}

/** The total for [hoursText] at [rateText] in [currency], or null while a box is empty. */
fun hourlyResult(hoursText: String, rateText: String, currency: String): HourlyResult? {
    if (hoursText.isBlank() || rateText.isBlank()) return null
    val hundredths = hoursFromTyped(hoursText) ?: return HourlyResult.Wrong(HourlyProblem.Hours)
    val rate = (parseAmount(rateText, currency) as? AmountInput.Valid)?.minor ?: return HourlyResult.Wrong(HourlyProblem.Rate)
    val total = hourlyTotal(rate, hundredths.toLong())?.takeIf { it >= 1 } ?: return HourlyResult.Wrong(HourlyProblem.Range)
    return HourlyResult.Total(total, java.math.BigDecimal.valueOf(hundredths.toLong(), 2).stripTrailingZeros().toPlainString(), rate)
}
