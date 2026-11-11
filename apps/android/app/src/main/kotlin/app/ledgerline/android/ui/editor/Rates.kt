package app.ledgerline.android.ui.editor

import java.math.BigInteger
import kotlin.math.abs

/*
 * Exchange-rate text for the payment sheets (ADR 0050, slice 4b), ported from `packages/shared/src/currency.ts` so the line
 * under an amount received reads as it does on the web. Exact integer arithmetic, never floating point; a fixture
 * generated from the web's functions (`rate-parity.json`) keeps the two the same. This is only ever shown: the server
 * works out the rate it saves from the amounts it is sent, and checks them again.
 */

/** Rates carry at most this many digits after the point. */
private const val RateDecimals = 10
private val RateScale = BigInteger.TEN.pow(RateDecimals)
private val Two = BigInteger.TWO

private fun pow10(digits: Int): BigInteger = BigInteger.TEN.pow(digits)

/** The rate as a whole number of 10^-10 units; [text] is exact decimal text such as "0.0081967213". */
private fun parseRate(text: String): BigInteger {
    val match = Regex("^(\\d+)(?:\\.(\\d+))?$").matchEntire(text) ?: throw IllegalArgumentException("Invalid rate")
    val fraction = (match.groupValues[2]).padEnd(RateDecimals, '0')
    require(fraction.length <= RateDecimals) { "Invalid rate" }
    return BigInteger(match.groupValues[1]) * RateScale + BigInteger(fraction)
}

/** Exact decimal text for a scaled rate, with trailing zeros trimmed ("1" for one). */
private fun formatRate(scaled: BigInteger): String {
    val whole = scaled / RateScale
    val fraction = (scaled % RateScale).toString().padStart(RateDecimals, '0').trimEnd('0')
    return if (fraction.isEmpty()) whole.toString() else "$whole.$fraction"
}

/**
 * The rate implied by a converted amount: base units one unit of [code] is worth, from a base amount and the amount it
 * came from (both in smallest units, any sign). Rounds half up at the stored precision and never returns zero.
 */
fun deriveRate(baseAmount: Long, amount: Long, code: String, baseCode: String): String {
    require(amount != 0L) { "Cannot derive a rate from zero" }
    val base = BigInteger.valueOf(abs(baseAmount))
    val smallest = BigInteger.valueOf(abs(amount))
    val numerator = base * pow10(currencyDigits(code)) * RateScale
    val denominator = smallest * pow10(currencyDigits(baseCode))
    val rounded = (numerator * Two + denominator) / (denominator * Two)
    return formatRate(if (rounded > BigInteger.ZERO) rounded else BigInteger.ONE)
}

/**
 * The same rate read the other way round, as exact decimal text: a stored 0.00812 (USD per BDT) reads as 123.1527 (BDT per
 * USD), the base currency first as people say it. Rounded half up, trailing zeros trimmed, about seven significant digits.
 */
fun invertRate(rate: String): String {
    val scaled = parseRate(rate)
    require(scaled > BigInteger.ZERO) { "A rate must be greater than zero" }
    fun at(digits: Int): BigInteger = (pow10(digits) * RateScale * Two + scaled) / (scaled * Two)
    val whole0 = at(0)
    val wholeDigits = whole0.toString().length
    val places = minOf(6, maxOf(2, 7 - (if (whole0 == BigInteger.ZERO) 0 else wholeDigits)))
    val unit = pow10(places)
    val inverted = at(places)
    val fraction = (inverted % unit).toString().padStart(places, '0').trimEnd('0')
    val whole = inverted / unit
    return if (fraction.isEmpty()) whole.toString() else "$whole.$fraction"
}

/** "1 USD = 0.8915 EUR": the base currency always first. */
fun rateSentence(code: String, rate: String, base: String): String = "1 $base = ${invertRate(rate)} $code"
