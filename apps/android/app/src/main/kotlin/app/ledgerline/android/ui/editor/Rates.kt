package app.ledgerline.android.ui.editor

import java.math.BigInteger
import kotlin.math.abs

/*
 * Exchange-rate math for the payment sheets (ADR 0050, slice 4b), ported from `packages/shared/src/currency.ts` so the line
 * under an amount received reads as it does on the web, and a rate typed by hand is stored the way the web stores it. Exact
 * integer arithmetic, never floating point; a fixture generated from the web's functions (`rate-parity.json`) keeps the
 * two the same. Everything here is for showing and for the rate a person types: the server works out the value it saves
 * from the amounts and the rate it is sent, and checks them again.
 */

/** Rates carry at most this many digits after the point. */
private const val RateDecimals = 10
private val RateScale = BigInteger.TEN.pow(RateDecimals)
private val Two = BigInteger.valueOf(2)

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

private val TypedRate = Regex("^\\d+(?:\\.\\d+)?$")
private val StorableRate = Regex("^\\d{1,10}(?:\\.\\d{1,10})?$")
private val MaxSafe = BigInteger.valueOf(9_007_199_254_740_991L)

/**
 * The rate to store for what a person typed, the base currency first ("1 USD is worth 122.5 BDT"): the inverse, as exact
 * decimal text at the stored precision. Null when the text is not a positive amount, or the rate it makes cannot be stored
 * (more than ten digits before the point, or nothing left after rounding).
 */
fun rateFromInverse(text: String): String? {
    val typed = text.trim()
    if (!TypedRate.matches(typed)) return null
    val scaled = try {
        parseRate(typed)
    } catch (_: IllegalArgumentException) {
        return null
    }
    if (scaled <= BigInteger.ZERO) return null
    val stored = (RateScale * RateScale * Two + scaled) / (scaled * Two)
    if (stored <= BigInteger.ZERO) return null
    return formatRate(stored).takeIf { StorableRate.matches(it) }
}

private val TypedByHand = Regex("^(\\d*)\\.?(\\d*)$")

/**
 * What a person typed in the rate field, read as they meant it, then stored like [rateFromInverse]. The web's own function
 * wants a digit before the point, so ".8" and "8." fail there; on the phone both are fine (".8" is 0.8, and "8." is what
 * "8.5" passes through while it is typed). Anything that is not one number with at most one point is still refused, and so
 * is zero, which includes an empty box or a lone point.
 */
fun rateFromTyped(text: String): String? {
    val match = TypedByHand.matchEntire(text.trim()) ?: return null
    val (whole, fraction) = match.destructured
    return rateFromInverse(whole.ifEmpty { "0" } + if (fraction.isEmpty()) "" else ".$fraction")
}

/**
 * [amount] in the smallest units of [from] as smallest units of [to], at [rate] (units of [to] per one unit of [from]).
 * Rounds half away from zero. Throws [ArithmeticException] when either side leaves the range a JavaScript number holds
 * exactly, as the web does.
 */
fun convertMinor(amount: Long, rate: String, from: String, to: String): Long {
    val magnitude = BigInteger.valueOf(amount).abs()
    if (magnitude > MaxSafe) throw ArithmeticException("Invalid amount")
    val numerator = magnitude * parseRate(rate) * pow10(currencyDigits(to))
    val denominator = RateScale * pow10(currencyDigits(from))
    val rounded = (numerator * Two + denominator) / (denominator * Two)
    if (rounded > MaxSafe) throw ArithmeticException("Converted amount exceeds the safe integer range")
    return if (amount < 0) -rounded.toLong() else rounded.toLong()
}

/** "1 USD = 0.8915 EUR": the base currency always first. */
fun rateSentence(code: String, rate: String, base: String): String = "1 $base = ${invertRate(rate)} $code"
