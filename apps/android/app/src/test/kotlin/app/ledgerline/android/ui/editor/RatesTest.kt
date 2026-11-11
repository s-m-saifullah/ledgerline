package app.ledgerline.android.ui.editor

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The rate sentence under an amount received (ADR 0050, slice 4b): the Kotlin rate math against the web's own. The fixture
 * `rate-parity.json` is generated from `packages/shared/src/currency.ts` (`deriveRate`, `invertRate`, `rateFromInverse`,
 * `convertMinor`), so a difference in
 * rounding or in the number of decimals fails here before it shows on a screen.
 */
class RatesTest {
    private val fixture = Json.parseToJsonElement(javaClass.getResource("/rate-parity.json")!!.readText()).jsonObject

    @Test
    fun theFixtureIsThere() {
        assertTrue(fixture["derive"]!!.jsonArray.size >= 50)
        assertTrue(fixture["invert"]!!.jsonArray.size >= 50)
        assertTrue(fixture["fromInverse"]!!.jsonArray.size >= 80)
        assertTrue(fixture["convert"]!!.jsonArray.size >= 200)
    }

    @Test
    fun everyTypedRateIsStoredAsTheWebStoresIt() {
        val cases = fixture["fromInverse"]!!.jsonArray
        cases.forEach { case ->
            val c = case.jsonObject
            val text = c["text"]!!.jsonPrimitive.content
            val expected = c["rate"]!!.let { if (it is kotlinx.serialization.json.JsonNull) null else it.jsonPrimitive.content }
            assertEquals("\"$text\"", expected, rateFromInverse(text))
        }
        // Both kinds are in the fixture: a typed rate that is stored and one that is refused.
        assertTrue(cases.any { it.jsonObject["rate"] is kotlinx.serialization.json.JsonNull })
        assertTrue(cases.any { it.jsonObject["rate"] !is kotlinx.serialization.json.JsonNull })
    }

    @Test
    fun everyConvertedAmountMatchesTheWebsConvertMinor() {
        val cases = fixture["convert"]!!.jsonArray
        cases.forEach { case ->
            val c = case.jsonObject
            val args = "${c["amount"]} ${c["rate"]} ${c["from"]} ${c["to"]}"
            val amount = c["amount"]!!.jsonPrimitive.long
            val rate = c["rate"]!!.jsonPrimitive.content
            val from = c["from"]!!.jsonPrimitive.content
            val to = c["to"]!!.jsonPrimitive.content
            val expected = c["result"]!!.jsonPrimitive.longOrNull
            if (expected == null) {
                assertThrows(args, ArithmeticException::class.java) { convertMinor(amount, rate, from, to) }
            } else {
                assertEquals(args, expected, convertMinor(amount, rate, from, to))
            }
        }
        // Both outcomes are in the fixture, and a negative amount rounds away from zero as the web does.
        assertTrue(cases.any { it.jsonObject["result"]!!.jsonPrimitive.content == "error" })
        assertTrue(cases.any { (it.jsonObject["result"]!!.jsonPrimitive.longOrNull ?: 0) < 0 })
    }

    @Test
    fun aTypedRateReadsBackAsTyped() {
        assertEquals("0.0081632653", rateFromInverse("122.5"))
        assertEquals("122.5", invertRate(rateFromInverse(" 122.5 ")!!))
        assertEquals(null, rateFromInverse("0"))
        assertEquals(null, rateFromInverse("12,5"))
        assertEquals(null, rateFromInverse(""))
    }

    @Test
    fun anAmountConvertsAtAStoredRate() {
        // 274.00 EUR at 1.0909 USD each is 298.9066 USD: 29,891 cents.
        assertEquals(29_891, convertMinor(27_400, "1.0909", "EUR", "USD"))
        // Different digits on the two sides: 5,000 yen at 0.0066 USD each is 33.00 USD.
        assertEquals(3_300, convertMinor(5_000, "0.0066", "JPY", "USD"))
        assertEquals(-3_300, convertMinor(-5_000, "0.0066", "JPY", "USD"))
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
