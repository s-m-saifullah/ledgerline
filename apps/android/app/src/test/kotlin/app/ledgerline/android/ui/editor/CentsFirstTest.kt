package app.ledgerline.android.ui.editor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The same cases as the web's amount-entry tests: typing from the cents must read the same on both apps. */
class CentsFirstTest {
    /** Type each character in turn, the way a keyboard reports it (the new text is the old plus one). */
    private fun type(start: String, keys: String, digits: Int = 2): String {
        var value = start
        for (key in keys) value = CentsFirst.edit(value, value + key, digits)
        return value
    }

    private fun backspace(start: String, times: Int, digits: Int = 2): String {
        var value = start
        repeat(times) { value = CentsFirst.edit(value, value.dropLast(1), digits) }
        return value
    }

    @Test
    fun digitsFillInFromTheRight() {
        assertEquals("0.01", type("", "1"))
        assertEquals("0.12", type("", "12"))
        assertEquals("1.23", type("", "123"))
        assertEquals("1234.56", type("", "123456"))
    }

    @Test
    fun leadingZerosStayOutOfTheWay() {
        assertEquals("0.00", type("", "0"))
        assertEquals("0.05", type("", "005"))
        assertEquals("0.50", type("", "0050"))
    }

    @Test
    fun followsTheCurrencysDecimals() {
        assertEquals("1500", type("", "1500", 0))
        assertEquals("1.234", type("", "1234", 3))
        assertEquals("0", CentsFirst.placeholder(0))
        assertEquals("0.00", CentsFirst.placeholder(2))
        assertEquals("0.000", CentsFirst.placeholder(3))
    }

    @Test
    fun backspaceDropsTheLastDigitAndEmptiesTheBoxAtZero() {
        assertEquals("1.23", backspace("12.34", 1))
        assertEquals("0.01", backspace("12.34", 3))
        assertEquals("", backspace("0.05", 1))
        assertEquals("", backspace("12.34", 4))
        assertEquals("", CentsFirst.edit("5", "", 0))
    }

    @Test
    fun appendsToAnExistingValueEvenOneSavedWithoutFullDecimals() {
        assertEquals("125.03", type("12.50", "3"))
        assertEquals("1000.02", type("100", "2"))
        assertEquals("75.01", type("7.5", "1"))
        assertEquals("10.00", backspace("100", 1))
    }

    @Test
    fun ignoresCharactersThatAreNotDigits() {
        assertEquals("12.34", CentsFirst.edit("12.34", "12.34.", 2))
        assertEquals("12.34", CentsFirst.edit("12.34", "12.34x", 2))
        assertEquals("100.00", CentsFirst.edit("100", "100.", 2))
        assertEquals("", CentsFirst.edit("", "-", 2))
    }

    @Test
    fun startsOverFromTheDigitsWhenTheWholeBoxIsReplaced() {
        assertEquals("0.05", CentsFirst.edit("12.34", "5", 2))
        assertEquals("9.95", CentsFirst.edit("12.34", "99.5", 2))
        assertEquals("", CentsFirst.edit("12.34", "", 2))
    }

    @Test
    fun refusesAValueBeyondTheLargestExactAmount() {
        val big = "90071992547409.91" // 9007199254740991 minor units
        assertEquals(big, CentsFirst.edit(big, big + "0", 2))
        assertEquals(big, type("", "9007199254740991"))
        assertEquals(big, type("", "90071992547409910"))
    }

    @Test
    fun aPastedAmountIsReadTheOrdinaryWay() {
        assertEquals("12.50", CentsFirst.pasted("12.50", 2))
        assertEquals("1200.50", CentsFirst.pasted("$1,200.5", 2))
        assertEquals("1250.00", CentsFirst.pasted("1250", 2))
        assertEquals("1250", CentsFirst.pasted("1250", 0))
        assertNull(CentsFirst.pasted("abc", 2))
        assertNull(CentsFirst.pasted("1.234", 2))
        assertNull(CentsFirst.pasted("-5", 2))
    }

    @Test
    fun severalCharactersAtOnceArePastedNotTyped() {
        // Without this a pasted 12.50 would be typed as the digits 1250 after the old text.
        assertEquals("12.50", CentsFirst.edit("", "12.50", 2))
        assertEquals("12.50", CentsFirst.edit("3.00", "3.0012.50", 2))
        assertEquals("1200.50", CentsFirst.edit("", "$1,200.5", 2))
        // Text that is not an amount changes nothing.
        assertEquals("1.23", CentsFirst.edit("1.23", "1.23abc", 2))
    }
}
