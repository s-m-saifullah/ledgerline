package app.ledgerline.android.ui.editor

import java.math.BigDecimal
import java.math.BigInteger

/**
 * Cents-first entry, as the web's `amount-entry.ts` (ADR 0045): digits fill in from the right and the decimal point
 * stays put, so typing 1, 2, 3 reads 0.01, 0.12, 1.23. These functions turn what the keyboard reports after an edit
 * into the next text of the box; the box always holds the plain decimal the ordinary box would, so [parseAmount]
 * and everything after it see the same value. Money stays exact: BigDecimal and BigInteger, never floating point.
 */
object CentsFirst {
    private val safeMax = BigInteger.valueOf(MaxMinor)

    /** What the empty box suggests: "0.00" for USD, "0" for JPY. */
    fun placeholder(digits: Int): String = show(BigInteger.ZERO, digits)

    /**
     * The box's next text after an edit. [previous] is what the box held, [next] what the keyboard shows now.
     * Digits typed at the end are appended, deleting the last character drops the last digit, and anything else (the
     * whole box replaced, an edit in the middle) starts over from the digits now present. Characters that are not
     * digits are ignored, and a value beyond the largest amount the server stores exactly is refused.
     */
    fun value(previous: String, next: String, digits: Int): String {
        val blank = previous.isBlank()
        val before = if (blank) BigInteger.ZERO else minorOf(previous, digits)
        val keep = if (before == null || blank) previous else show(before, digits)
        if (next.isBlank()) return ""
        val minor: BigInteger = when {
            before != null && next.startsWith(previous) -> {
                val typed = next.substring(previous.length).filter { it in '0'..'9' }
                if (typed.isEmpty()) return keep
                before * BigInteger.TEN.pow(typed.length) + BigInteger(typed)
            }
            before != null && previous.length - next.length == 1 && previous.startsWith(next) -> {
                val dropped = before / BigInteger.TEN
                if (dropped.signum() == 0) return ""
                dropped
            }
            else -> {
                val all = next.filter { it in '0'..'9' }
                if (all.isEmpty()) return keep
                BigInteger(all)
            }
        }
        return if (minor > safeMax) keep else show(minor, digits)
    }

    /** A pasted amount is read the ordinary way ("12.50" is 12.50, "1250" is 1250.00); null when it is unclear. */
    fun pasted(text: String, digits: Int): String? {
        val minor = minorOf(text, digits) ?: return null
        return if (minor > safeMax) null else show(minor, digits)
    }

    /**
     * What a keyboard edit means: one character typed or deleted is [value]; several characters at once are a paste,
     * which replaces the box with the pasted amount (or changes nothing when the text is not an amount).
     */
    fun edit(previous: String, next: String, digits: Int): String {
        if (next.length - previous.length < 2) return value(previous, next, digits)
        var start = 0
        while (start < previous.length && start < next.length && previous[start] == next[start]) start++
        var end = 0
        while (end < previous.length - start && end < next.length - start &&
            previous[previous.length - 1 - end] == next[next.length - 1 - end]
        ) end++
        val inserted = next.substring(start, next.length - end)
        return pasted(inserted, digits) ?: previous
    }

    /** A typed or stored amount as whole minor units, or null when it is not a plain decimal. */
    private fun minorOf(text: String, digits: Int): BigInteger? {
        val cleaned = clean(text)
        val pattern = if (digits == 0) Regex("^\\d+$") else Regex("^\\d+(?:\\.\\d{1,$digits})?$")
        if (!pattern.matches(cleaned)) return null
        return BigDecimal(cleaned).movePointRight(digits).toBigIntegerExact()
    }

    private fun show(minor: BigInteger, digits: Int): String = BigDecimal(minor).movePointLeft(digits).toPlainString()

    /** "$1,200.50" and " 12.5 " as a plain decimal; a lone "." or "12." is cleaned the way the web does. */
    private fun clean(text: String): String {
        var value = text.trim().replace(Regex("^\\$\\s*"), "").replace(Regex("\\s+"), "")
        if (Regex("^\\d{1,3}(,\\d{3})+(\\.\\d*)?$").matches(value)) value = value.replace(",", "")
        if (Regex("^\\.\\d").containsMatchIn(value)) value = "0$value"
        if (Regex("^\\d+\\.$").matches(value)) value = value.dropLast(1)
        return value
    }
}
