package app.ledgerline.android.ui.clients

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** What an account in another currency adds to a payment (ADR 0050, slice 4b-1): the amount received, the tip and the rate. */
class CrossCurrencyTest {
    private fun cross(item: String = "USD", account: String = "EUR", received: String = "", tip: String = "") = CrossCurrency(item, account, received, tip)

    @Test
    fun onlyAPairWithoutTheBaseCurrencyNeedsARate() {
        assertTrue(needsRate("EUR", "GBP"))
        assertTrue(needsRate("GBP", "EUR"))
        assertFalse(needsRate("EUR", "EUR"))
        assertFalse(needsRate("USD", "EUR"))
        assertFalse(needsRate("EUR", "USD"))
        assertFalse(needsRate("USD", "USD"))
    }

    private fun gbp(received: String = "390.00", typed: String = "", stored: StoredRate = StoredRate.Looking) =
        CrossCurrency("EUR", "GBP", received, "", rateTyped = typed, stored = stored)

    private val found = StoredRate.Found("1.2658227848", "2026-11-07")

    @Test
    fun aRateIsOnlyNeededWhenNeitherSideIsTheBaseCurrency() {
        assertTrue(gbp().needsRate)
        assertFalse(cross(item = "USD", account = "EUR").needsRate)
        assertFalse(cross(item = "EUR", account = "USD").needsRate)
    }

    @Test
    fun aTypedRateIsReadBaseFirstAndStoredTheWayTheWebStoresIt() {
        assertEquals("0.0081632653", gbp(typed = "122.5").manualRate)
        assertEquals("0.0081632653", gbp(typed = " 122.5 ").manualRate)
        assertNull(gbp(typed = "").manualRate)
        assertNull(gbp(typed = "abc").manualRate)
        assertNull(gbp(typed = "0").manualRate)
    }

    @Test
    fun aTypedRateThatCannotBeStoredIsAProblemButABlankOneIsNot() {
        assertFalse(gbp(typed = "").rateTypedIssue)
        assertFalse(gbp(typed = "  ").rateTypedIssue)
        assertFalse(gbp(typed = "122.5").rateTypedIssue)
        assertTrue(gbp(typed = "abc").rateTypedIssue)
        assertTrue(gbp(typed = "0").rateTypedIssue)
        assertTrue(gbp(typed = "12,5").rateTypedIssue)
    }

    @Test
    fun noRateIsTypedOrSentWhenOneSideIsTheBaseCurrency() {
        val c = CrossCurrency("USD", "EUR", "92.00", "", rateTyped = "122.5", stored = found)
        assertNull(c.manualRate)
        assertFalse(c.rateTypedIssue)
        assertNull(c.rateInUse)
        assertNull(c.baseValue())
        assertFalse(c.rateMissing)
    }

    @Test
    fun theRateInUseIsTheOneTypedThenTheStoredOne() {
        assertEquals("1.2658227848", gbp(stored = found).rateInUse)
        assertEquals("0.0081632653", gbp(typed = "122.5", stored = found).rateInUse)
        assertNull(gbp(stored = StoredRate.Missing).rateInUse)
        assertNull(gbp(stored = StoredRate.Looking).rateInUse)
        assertNull(gbp(stored = StoredRate.Unavailable).rateInUse)
        assertEquals("0.0081632653", gbp(typed = "122.5", stored = StoredRate.Missing).rateInUse)
        // A typed rate that is not valid is not used; the stored one still is.
        assertEquals("1.2658227848", gbp(typed = "abc", stored = found).rateInUse)
    }

    @Test
    fun onlyAFoundOutMissingRateWithNothingTypedBlocksSaving() {
        assertTrue(gbp(stored = StoredRate.Missing).rateMissing)
        assertFalse(gbp(stored = StoredRate.Missing, typed = "122.5").rateMissing)
        assertFalse(gbp(stored = StoredRate.Missing, typed = "abc").rateMissing)
        assertFalse(gbp(stored = StoredRate.Looking).rateMissing)
        assertFalse(gbp(stored = StoredRate.Unavailable).rateMissing)
        assertFalse(gbp(stored = found).rateMissing)
    }

    @Test
    fun whatArrivedIsWorthAboutThisMuchInTheBaseCurrency() {
        // 390.00 GBP at 1.2658227848 USD each: 493.67 USD, in cents.
        assertEquals(49_367L, gbp(stored = found).baseValue())
        // 390.00 GBP at 1 / 122.5: 3.18 USD.
        assertEquals(318L, gbp(typed = "122.5", stored = found).baseValue())
        assertNull(gbp(received = "", stored = found).baseValue())
        assertNull(gbp(stored = StoredRate.Missing).baseValue())
    }

    @Test
    fun theWorthIsConvertedFromTheAccountsCurrencyIntoDollarsWhateverTheirDecimals() {
        // 41,000 yen (no decimals) at 0.0065746219 USD each is 269.56 USD; the same pair the other way round would be far off.
        val yen = CrossCurrency("EUR", "JPY", "41000", "", stored = StoredRate.Found("0.0065746219", null))
        assertEquals(26_956L, yen.baseValue())
        // A currency with three decimals (1.250 BHD at 2.6525 USD each is 3.32 USD).
        val dinar = CrossCurrency("EUR", "BHD", "1.250", "", stored = StoredRate.Found("2.6525", null))
        assertEquals(332L, dinar.baseValue())
    }

    @Test
    fun theRateSentenceForTheAccountsCurrencyIsTheSameAsAnyOther() {
        assertEquals("1 USD = 0.79 GBP", gbp(stored = found).rateInUse!!.let { CrossRate("GBP", it).sentence })
        assertEquals("1 USD = 122.5 GBP", CrossRate("GBP", gbp(typed = "122.5").manualRate!!).sentence)
    }

    @Test
    fun aStoredAnswerOnlyCountsForTheAccountAndDateItWasAskedFor() {
        val answer = RateAnswer(RateKey("GBP", "2026-11-10"), found)
        assertEquals(found, answer.storedFor(RateKey("GBP", "2026-11-10")))
        assertEquals(StoredRate.Looking, answer.storedFor(RateKey("GBP", "2026-11-09")))
        assertEquals(StoredRate.Looking, answer.storedFor(RateKey("EUR", "2026-11-10")))
        assertEquals(StoredRate.Looking, (null as RateAnswer?).storedFor(RateKey("GBP", "2026-11-10")))
    }

    @Test
    fun whatArrivedIsReadInTheAccountsOwnDecimals() {
        assertEquals(41_000L, cross(received = "410.00").receivedMinor)
        assertEquals(41_000L, cross(account = "JPY", received = "41000").receivedMinor)
        assertNull(cross(received = "").receivedMinor)
        assertNull(cross(account = "JPY", received = "41000.5").receivedMinor)
    }

    @Test
    fun anAmountReceivedThatIsNotRightIsSaidWhy() {
        assertEquals(AmountIssue.Missing, cross(received = "").receivedIssue)
        assertEquals(AmountIssue.Invalid, cross(received = "abc").receivedIssue)
        assertEquals(AmountIssue.TooPrecise, cross(received = "1.234").receivedIssue)
        assertEquals(AmountIssue.Zero, cross(received = "0").receivedIssue)
        assertNull(cross(received = "410.00").receivedIssue)
    }

    @Test
    fun aTipMayBeLeftBlankButOneTypedHasToBeValid() {
        assertNull(cross(tip = "").tipIssue)
        assertNull(cross(tip = "   ").tipIssue)
        assertEquals(0L, cross(tip = "").tipMinor)
        assertEquals(AmountIssue.Invalid, cross(tip = "x").tipIssue)
        assertEquals(AmountIssue.Zero, cross(tip = "0").tipIssue)
        assertNull(cross(tip = "5.50").tipIssue)
        assertEquals(550L, cross(tip = "5.50").tipMinor)
        assertEquals(0L, cross(tip = "x").tipMinor)
    }

    @Test
    fun aDollarServicePaidIntoEurosShowsHowManyEurosOneDollarIsWorth() {
        assertEquals(CrossRate("EUR", "1.0869565217"), cross(item = "USD", account = "EUR", received = "92.00").rate(10_000))
        assertEquals("1 USD = 0.92 EUR", cross(item = "USD", account = "EUR", received = "92.00").rate(10_000)!!.sentence)
    }

    @Test
    fun aEuroServicePaidIntoDollarsShowsTheSameWay() {
        assertEquals("1 USD = 0.92 EUR", cross(item = "EUR", account = "USD", received = "100.00").rate(9_200)!!.sentence)
    }

    @Test
    fun noRateWhileEitherAmountIsMissingOrWhenNeitherSideIsTheBaseCurrency() {
        assertNull(cross(received = "").rate(10_000))
        assertNull(cross(received = "92.00").rate(null))
        assertNull(cross(received = "92.00").rate(0))
        assertNull(cross(item = "EUR", account = "GBP", received = "92.00").rate(10_000))
        assertNull(gbp(stored = found).rate(10_000))
    }
}
