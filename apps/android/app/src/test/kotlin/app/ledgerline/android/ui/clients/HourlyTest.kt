package app.ledgerline.android.ui.clients

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The hourly helper on Log service (ADR 0026): the Kotlin maths against the web's own. The fixture `hourly-parity.json` is
 * generated from `packages/shared/src/receivables.ts` (`hoursToHundredths`, `hourlyTotal`), so a difference in rounding or in
 * what counts as valid hours fails here before it shows on a screen.
 */
class HourlyTest {
    private val fixture = Json.parseToJsonElement(javaClass.getResource("/hourly-parity.json")!!.readText()).jsonObject

    @Test
    fun theFixtureIsThere() {
        assertTrue(fixture["hours"]!!.jsonArray.size >= 80)
        assertTrue(fixture["total"]!!.jsonArray.size >= 150)
    }

    @Test
    fun everyTypedHourCountIsReadAsTheWebReadsIt() {
        val cases = fixture["hours"]!!.jsonArray
        cases.forEach { case ->
            val c = case.jsonObject
            val text = c["text"]!!.jsonPrimitive.content
            val expected = c["hundredths"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.long.toInt() }
            assertEquals("\"$text\"", expected, hoursToHundredths(text))
        }
        assertTrue(cases.any { it.jsonObject["hundredths"] is JsonNull })
        assertTrue(cases.any { it.jsonObject["hundredths"] !is JsonNull })
    }

    @Test
    fun everyTotalIsRoundedAsTheWebRoundsIt() {
        val cases = fixture["total"]!!.jsonArray
        cases.forEach { case ->
            val c = case.jsonObject
            val rate = c["rate"]!!.jsonPrimitive.long
            val hundredths = c["hundredths"]!!.jsonPrimitive.long
            val expected = c["total"]!!.jsonPrimitive.longOrNull
            assertEquals("$rate x $hundredths", expected, hourlyTotal(rate, hundredths))
        }
        assertTrue(cases.any { it.jsonObject["total"] is JsonNull })
        assertTrue(cases.any { it.jsonObject["total"] !is JsonNull })
    }

    @Test
    fun theTotalRoundsHalfUpToTheSmallestUnit() {
        // 1 cent an hour for 0.50 hours is half a cent: up. For 0.49 hours it is below half: down.
        assertEquals(1L, hourlyTotal(1, 50))
        assertEquals(0L, hourlyTotal(1, 49))
        assertEquals(14_000L, hourlyTotal(4_000, 350))
    }

    @Test
    fun theTotalBeyondTheSafeMoneyRangeIsNull() {
        assertNull(hourlyTotal(9_007_199_254_740_991L, 200))
        assertEquals(9_007_199_254_740_991L, hourlyTotal(9_007_199_254_740_991L, 100))
    }

    @Test
    fun aTypedHourCountMayStartOrEndWithThePointOrUseAComma() {
        // The web's parser is strict; a typed field is not (memory: numbers without a leading zero).
        assertEquals(50, hoursFromTyped(".5"))
        assertEquals(200, hoursFromTyped("2."))
        assertEquals(150, hoursFromTyped("1,5"))
        assertEquals(350, hoursFromTyped(" 3.5 "))
        assertNull(hoursFromTyped("."))
        assertNull(hoursFromTyped(","))
        assertNull(hoursFromTyped("1.234"))
        assertNull(hoursFromTyped("0"))
        assertNull(hoursFromTyped("abc"))
    }

    @Test
    fun nothingIsSaidWhileABoxIsEmpty() {
        assertNull(hourlyResult("", "40", "USD"))
        assertNull(hourlyResult("3.5", "", "USD"))
        assertNull(hourlyResult("  ", "40", "USD"))
        assertNull(hourlyResult("3.5", "  ", "USD"))
    }

    @Test
    fun aGoodPairGivesTheTotalAndHowItWasWorkedOut() {
        val result = hourlyResult("3.5", "40", "USD") as HourlyResult.Total
        assertEquals(14_000L, result.total)
        assertEquals("3.5", result.hours)
        assertEquals(4_000L, result.rate)
    }

    @Test
    fun theHoursAreShownWithoutTrailingZeros() {
        assertEquals("0.25", (hourlyResult("0.25", "40", "USD") as HourlyResult.Total).hours)
        assertEquals("2", (hourlyResult("2.00", "40", "USD") as HourlyResult.Total).hours)
        assertEquals("0.5", (hourlyResult(".5", "40", "USD") as HourlyResult.Total).hours)
        assertEquals("12.5", (hourlyResult("12.50", "40", "USD") as HourlyResult.Total).hours)
    }

    @Test
    fun badHoursAreSaidApartFromABadRate() {
        assertEquals(HourlyResult.Wrong(HourlyProblem.Hours), hourlyResult("abc", "40", "USD"))
        assertEquals(HourlyResult.Wrong(HourlyProblem.Hours), hourlyResult("1.234", "40", "USD"))
        assertEquals(HourlyResult.Wrong(HourlyProblem.Hours), hourlyResult("0", "40", "USD"))
        assertEquals(HourlyResult.Wrong(HourlyProblem.Rate), hourlyResult("3.5", "abc", "USD"))
        assertEquals(HourlyResult.Wrong(HourlyProblem.Rate), hourlyResult("3.5", "0", "USD"))
        assertEquals(HourlyResult.Wrong(HourlyProblem.Rate), hourlyResult("3.5", "40.123", "USD"))
    }

    @Test
    fun theRateFollowsTheCurrencysDecimals() {
        assertEquals(1_400L, (hourlyResult("2", "700", "JPY") as HourlyResult.Total).total)
        assertEquals(HourlyResult.Wrong(HourlyProblem.Rate), hourlyResult("2", "700.5", "JPY"))
        assertEquals(14_000L, (hourlyResult("2", "7", "BHD") as HourlyResult.Total).total)
    }

    @Test
    fun aTotalOutsideTheMoneyRangeOrBelowOneUnitIsRefused() {
        assertEquals(HourlyResult.Wrong(HourlyProblem.Range), hourlyResult("9999.99", "90071992547409", "USD"))
        // 0.01 hours at 0.01 is a hundredth of a cent: rounds to 0.
        assertEquals(HourlyResult.Wrong(HourlyProblem.Range), hourlyResult("0.01", "0.01", "USD"))
    }
}
