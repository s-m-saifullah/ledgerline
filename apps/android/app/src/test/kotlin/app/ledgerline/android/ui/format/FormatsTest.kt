package app.ledgerline.android.ui.format

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

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
    fun theLastUpdateShowsATimeTodayAndADateOtherwise() {
        val zone = ZoneId.of("America/Chicago")
        assertEquals("5:42 AM", formatUpdated("2026-10-22T10:42:00.000Z", zone, LocalDate.of(2026, 10, 22), us).replace(' ', ' '))
        assertEquals("Oct 21, 2026, 5:42 AM", formatUpdated("2026-10-21T10:42:00Z", zone, LocalDate.of(2026, 10, 22), us).replace(' ', ' '))
    }

    @Test
    fun anEntryDateIsAMediumDate() {
        assertEquals("Oct 20, 2026", formatEntryDate("2026-10-20", us))
    }
}
