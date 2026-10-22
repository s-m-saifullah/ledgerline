package app.ledgerline.android.ui.editor

import org.junit.Assert.assertEquals
import org.junit.Test

class AmountsTest {
    private fun minor(text: String, currency: String = "USD") = (parseAmount(text, currency) as AmountInput.Valid).minor

    @Test
    fun typedAmountsBecomeExactMinorUnits() {
        assertEquals(1_250L, minor("12.50"))
        assertEquals(1_250L, minor("12,5"))
        assertEquals(5L, minor("0.05"))
        assertEquals(50L, minor(".5"))
        assertEquals(500L, minor("5."))
        assertEquals(123_456L, minor(" 1 234.56 "))
        assertEquals(1_234L, minor("1234", "JPY"))
        assertEquals(1_234L, minor("1.234", "BHD"))
    }

    @Test
    fun theLargestExactAmountIsAcceptedAndOneMoreIsNot() {
        assertEquals(MaxMinor, minor("90071992547409.91"))
        assertEquals(AmountInput.TooLarge, parseAmount("90071992547409.92", "USD"))
    }

    @Test
    fun nothingIsEverRounded() {
        assertEquals(AmountInput.TooPrecise, parseAmount("12.505", "USD"))
        assertEquals(AmountInput.TooPrecise, parseAmount("12.5", "JPY"))
        assertEquals(1_250L, minor("12.500"))
    }

    @Test
    fun anythingElseIsAnError() {
        assertEquals(AmountInput.Missing, parseAmount("  ", "USD"))
        assertEquals(AmountInput.Zero, parseAmount("0.00", "USD"))
        listOf("-5", "abc", "1,234.56", "1.2.3", ".", "1e3").forEach {
            assertEquals(it, AmountInput.Invalid, parseAmount(it, "USD"))
        }
    }

    @Test
    fun minorUnitsGoBackToTheFieldWithoutASign() {
        assertEquals("25.50", amountText(-2_550, "USD"))
        assertEquals("1234", amountText(1_234, "JPY"))
        assertEquals("90071992547409.91", amountText(MaxMinor, "USD"))
    }
}
