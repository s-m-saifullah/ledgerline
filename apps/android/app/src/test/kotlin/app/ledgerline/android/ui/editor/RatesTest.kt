package app.ledgerline.android.ui.editor

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The rate sentence under an amount received (ADR 0050, slice 4b): the Kotlin rate math against the web's own. The fixture
 * `rate-parity.json` is generated from `packages/shared/src/currency.ts` (`deriveRate`, `invertRate`), so a difference in
 * rounding or in the number of decimals fails here before it shows on a screen.
 */
class RatesTest {
    private val fixture = Json.parseToJsonElement(javaClass.getResource("/rate-parity.json")!!.readText()).jsonObject

    @Test
    fun theFixtureIsThere() {
        assertTrue(fixture["derive"]!!.jsonArray.size >= 50)
        assertTrue(fixture["invert"]!!.jsonArray.size >= 50)
    }

    @Test
    fun everyDerivedRateMatchesTheWebsDeriveRate() {
        fixture["derive"]!!.jsonArray.forEach { case ->
            val c = case.jsonObject
            val args = "${c["base"]} ${c["amount"]} ${c["code"]}"
            assertEquals(args, c["rate"]!!.jsonPrimitive.content, deriveRate(c["base"]!!.jsonPrimitive.long, c["amount"]!!.jsonPrimitive.long, c["code"]!!.jsonPrimitive.content, "USD"))
        }
    }

    @Test
    fun everyInvertedRateMatchesTheWebsInvertRate() {
        fixture["invert"]!!.jsonArray.forEach { case ->
            val c = case.jsonObject
            val rate = c["rate"]!!.jsonPrimitive.content
            assertEquals(rate, c["inverted"]!!.jsonPrimitive.content, invertRate(rate))
        }
    }

    @Test
    fun aRateShowsBaseFirstAsPeopleSayIt() {
        assertEquals("1 USD = 0.92 EUR", rateSentence("EUR", "1.0869565217", "USD"))
        assertEquals("1 USD = 152.1 JPY", rateSentence("JPY", "0.0065746219", "USD"))
    }

    @Test
    fun theSignOfAnAmountDoesNotMatter() {
        assertEquals(deriveRate(10_000, 9_200, "EUR", "USD"), deriveRate(-10_000, -9_200, "EUR", "USD"))
    }

    @Test
    fun aRateCannotBeDerivedFromNothing() {
        assertThrows(IllegalArgumentException::class.java) { deriveRate(10_000, 0, "EUR", "USD") }
        assertThrows(IllegalArgumentException::class.java) { invertRate("0") }
    }

    @Test
    fun aDerivedRateIsNeverZero() {
        assertEquals("0.0000000001", deriveRate(1, 9_007_199_254_740, "EUR", "USD"))
    }
}
