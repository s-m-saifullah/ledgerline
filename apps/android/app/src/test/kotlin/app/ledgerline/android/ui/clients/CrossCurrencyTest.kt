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
    fun anAccountIsUsableWhenTheCurrenciesMatchOrOneSideIsTheBaseCurrency() {
        assertTrue(usableAccount("USD", "USD"))
        assertTrue(usableAccount("EUR", "EUR"))
        assertTrue(usableAccount("USD", "EUR"))
        assertTrue(usableAccount("EUR", "USD"))
        assertFalse(usableAccount("EUR", "GBP"))
        assertFalse(usableAccount("GBP", "EUR"))
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
    }
}
