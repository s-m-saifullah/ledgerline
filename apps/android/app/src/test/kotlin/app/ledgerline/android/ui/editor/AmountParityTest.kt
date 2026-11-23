package app.ledgerline.android.ui.editor

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Typing and reading an amount on the phone against the web's own (ADR 0028, ADR 0045). The fixture `amount-parity.json`
 * is built from `apps/web/src/components/amount-entry.ts` and the web's typed-amount reader by a web unit test
 * (`android-parity.test.ts`) that fails when the committed file is out of date, so a change to the web's entry rules
 * reaches this suite. Left out on purpose, because the phone reads them differently: a comma as the decimal point and a
 * leading "$" (see the fixture's note in that test).
 */
class AmountParityTest {
    private val fixture = Json.parseToJsonElement(javaClass.getResource("/amount-parity.json")!!.readText()).jsonObject

    private fun cases(name: String): JsonArray = fixture[name]!!.jsonArray

    private fun JsonObject.text(key: String): String? = this[key]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }

    /** Every case the phone reads differently, so one run shows all of them. */
    private fun differences(name: String, read: (JsonObject) -> Pair<String, Pair<Any?, Any?>>) {
        val wrong = cases(name).mapNotNull { case ->
            val (label, answers) = read(case.jsonObject)
            if (answers.first == answers.second) null else "$label: web ${answers.first}, phone ${answers.second}"
        }
        assertEquals(emptyList<String>(), wrong)
    }

    @Test
    fun theFixtureIsThere() {
        assertTrue(cases("cents").size >= 300)
        assertTrue(cases("pasted").size >= 60)
        assertTrue(cases("placeholder").size == 3)
        assertTrue(cases("typed").size >= 200)
    }

    @Test
    fun everyKeyboardEditIsReadAsTheWebReadsIt() {
        differences("cents") { c ->
            val previous = c.text("previous")!!
            val next = c.text("next")!!
            val digits = c["digits"]!!.jsonPrimitive.int
            "\"$previous\" -> \"$next\" with $digits decimals" to (c.text("value") to CentsFirst.value(previous, next, digits))
        }
    }

    @Test
    fun everyPastedAmountIsReadAsTheWebReadsIt() {
        differences("pasted") { c ->
            val text = c.text("text")!!
            val digits = c["digits"]!!.jsonPrimitive.int
            "pasted \"$text\" with $digits decimals" to (c.text("value") to CentsFirst.pasted(text, digits))
        }
    }

    @Test
    fun theEmptyBoxSuggestsWhatTheWebSuggests() {
        differences("placeholder") { c ->
            val digits = c["digits"]!!.jsonPrimitive.int
            "$digits decimals" to (c.text("text") to CentsFirst.placeholder(digits))
        }
    }

    @Test
    fun everyTypedAmountIsReadAsTheWebReadsIt() {
        differences("typed") { c ->
            val text = c.text("text")!!
            val currency = c.text("currency")!!
            val expected = c["minor"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.long }
            "\"$text\" in $currency" to (expected to (parseAmount(text, currency) as? AmountInput.Valid)?.minor)
        }
    }

    /** The one thing the phone reads more kindly than the web: zeros beyond the currency's decimals (the value is exact, never rounded). */
    @Test
    fun zerosBeyondTheCurrencysDecimalsAreKeptOutOfTheFixtureAndStillAccepted() {
        assertEquals(AmountInput.Valid(100_000), parseAmount("1000.000", "USD"))
        assertEquals(AmountInput.Valid(1), parseAmount("1.0", "JPY"))
        assertEquals(AmountInput.TooPrecise, parseAmount("1000.001", "USD"))
        assertTrue(cases("typed").none { it.jsonObject.text("text") == "1000.000" && it.jsonObject.text("currency") == "USD" })
    }

    @Test
    fun bothKindsAreInTheFixture() {
        assertTrue(cases("typed").any { it.jsonObject["minor"] is JsonNull })
        assertTrue(cases("typed").any { it.jsonObject["minor"] !is JsonNull })
        assertTrue(cases("pasted").any { it.jsonObject["value"] is JsonNull })
        assertTrue(cases("pasted").any { it.jsonObject["value"] !is JsonNull })
        assertTrue(cases("cents").any { it.jsonObject["value"]!!.jsonPrimitive.content.isEmpty() })
    }
}
