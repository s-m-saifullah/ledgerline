package app.ledgerline.android.ui.format

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Test
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

class FormatsTest {
    private val us = Locale.US

    @Test
    fun minorUnitsBecomeTheCurrencysDecimals() {
        assertEquals("$1,234.56", formatMoney(123_456, "USD", us))
        assertEquals("-$25.50", formatMoney(-2_550, "USD", us))
        assertEquals("¥1,234", formatMoney(1_234, "JPY", us))
        assertEquals("€0.05", formatMoney(5, "EUR", us))
    }

    @Test
    fun theLargestExactAmountKeepsEveryDigit() {
        assertEquals("$90,071,992,547,409.91", formatMoney(9_007_199_254_740_991, "USD", us))
    }

    @Test
    fun anUnknownCodeIsShownWithTwoDecimals() {
        assertEquals("XYZ 12.34", formatMoney(1_234, "XYZ", us))
    }

    @Test
    fun theFormatIsBuiltOncePerLocaleAndCurrency() {
        assertSame(moneyStyle("USD", us), moneyStyle("USD", us))
        assertNotSame(moneyStyle("USD", us), moneyStyle("EUR", us))
        assertNotSame(moneyStyle("USD", us), moneyStyle("USD", Locale.GERMANY))
        assertSame("an unknown code is kept too", moneyStyle("XYZ", us), moneyStyle("XYZ", us))
    }

    @Test
    fun aLocaleChangeBetweenCallsIsFollowed() {
        assertEquals("$1,234.56", formatMoney(123_456, "USD", us))
        assertEquals("1.234,56 €", formatMoney(123_456, "EUR", Locale.GERMANY).replace('\u00a0', ' '))
        assertEquals("€1,234.56", formatMoney(123_456, "EUR", us))
        assertEquals("1.234,56 $", formatMoney(123_456, "USD", Locale.GERMANY).replace('\u00a0', ' '))
        assertEquals("$1,234.56", formatMoney(123_456, "USD", us))
    }

    @Test
    fun theDefaultLocaleIsReadOnEveryCall() {
        val before = Locale.getDefault()
        try {
            Locale.setDefault(Locale.US)
            assertEquals("$1,234.56", formatMoney(123_456, "USD"))
            Locale.setDefault(Locale.GERMANY)
            assertEquals("1.234,56 $", formatMoney(123_456, "USD").replace('\u00a0', ' '))
        } finally {
            Locale.setDefault(before)
        }
    }

    @Test
    fun eachThreadHasItsOwnFormatBecauseAFormatIsNotThreadSafe() {
        val mine = moneyStyle("USD", us)
        var theirs: Any? = null
        thread { theirs = moneyStyle("USD", us) }.join()
        assertNotSame(mine, theirs)
    }

    @Test
    fun manyThreadsFormatingTogetherAllGetTheRightText() {
        val amounts = listOf(5L, 1_234L, 123_456L, 99_999_999L, -2_550L)
        val expected = amounts.map { formatMoney(it, "USD", us) to formatMoney(it, "JPY", us) }
        val wrong = AtomicInteger()
        val threads = List(8) {
            thread {
                repeat(3_000) { n ->
                    val i = n % amounts.size
                    if (formatMoney(amounts[i], "USD", us) != expected[i].first || formatMoney(amounts[i], "JPY", us) != expected[i].second) wrong.incrementAndGet()
                }
            }
        }
        threads.forEach { it.join() }
        assertEquals(0, wrong.get())
    }
}
