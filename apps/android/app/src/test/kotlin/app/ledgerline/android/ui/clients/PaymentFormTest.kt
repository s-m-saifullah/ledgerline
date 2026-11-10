package app.ledgerline.android.ui.clients

import app.ledgerline.api.CreatePayment
import app.ledgerline.api.Money
import app.ledgerline.api.TipInput
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Record payment form as plain data (ADR 0050): what it starts with, what is wrong with it, what it sends. */
class PaymentFormTest {
    private val target = PaymentTarget(
        serviceId = "svc-1", serviceVersion = 3, description = "Logo refresh", clientName = "Northwind Design",
        currency = "USD", outstanding = 45_000,
    )

    private fun form(
        amount: String = "450.00",
        accountId: String? = "a1",
        categoryId: String? = "c1",
        tipCategoryId: String? = null,
        time: String? = null,
        note: String = "",
        target: PaymentTarget = this.target,
    ) = PaymentForm(target, amount, accountId, categoryId, tipCategoryId, date = "2026-11-09", time = time, note = note)

    @Test
    fun aNewFormStartsWithTheFullOutstandingAmountAndTodayAndNothingElseChosen() {
        val start = PaymentForm.forService(target, today = "2026-11-09")
        assertEquals("450.00", start.amount)
        assertEquals("2026-11-09", start.date)
        assertNull(start.accountId)
        assertNull(start.categoryId)
        assertNull(start.tipCategoryId)
        assertNull(start.time)
        assertEquals("", start.note)
    }

    @Test
    fun theStartingAmountUsesTheCurrencysOwnDecimals() {
        assertEquals("1200", PaymentForm.forService(target.copy(currency = "JPY", outstanding = 1_200), "2026-11-09").amount)
        assertEquals("1.250", PaymentForm.forService(target.copy(currency = "BHD", outstanding = 1_250), "2026-11-09").amount)
    }

    @Test
    fun payingExactlyWhatIsOutstandingSettlesItAndHasNoTip() {
        val request = form().request()!!
        assertEquals(
            CreatePayment(Money(45_000, "USD"), accountId = "a1", categoryId = "c1", date = "2026-11-09", expectedReceivableVersion = 3),
            request,
        )
    }

    @Test
    fun payingLessSettlesWhatWasTypedAndHasNoTip() {
        val request = form(amount = "120.50").request()!!
        assertEquals(Money(12_050, "USD"), request.amount)
        assertNull(request.tip)
    }

    @Test
    fun payingMoreSettlesTheOutstandingAmountAndSavesTheRestAsATipInTheServicesCurrency() {
        val request = form(amount = "460.25", tipCategoryId = "c2").request()!!
        assertEquals(Money(45_000, "USD"), request.amount)
        assertEquals(TipInput(Money(1_025, "USD"), "c2"), request.tip)
    }

    @Test
    fun aTipCategoryThatIsNotNeededIsNotSent() {
        assertNull(form(amount = "450.00", tipCategoryId = "c2").request()!!.tip)
        assertNull(form(amount = "10.00", tipCategoryId = "c2").request()!!.tip)
    }

    @Test
    fun theAmountAndTheTipCarryTheServicesOwnCurrency() {
        val euros = target.copy(currency = "EUR", outstanding = 10_000)
        val request = form(amount = "105.50", tipCategoryId = "c2", target = euros).request()!!
        assertEquals(Money(10_000, "EUR"), request.amount)
        assertEquals(TipInput(Money(550, "EUR"), "c2"), request.tip)
    }

    @Test
    fun theVersionOfTheServiceThePhoneHoldsTravelsWithThePayment() {
        assertEquals(7, form(target = target.copy(serviceVersion = 7)).request()!!.expectedReceivableVersion)
    }

    @Test
    fun aTimeIsSentWhenSetAndANoteIsTrimmedAndLeftOutWhenBlank() {
        val request = form(time = "14:30", note = "  Paid in cash  ").request()!!
        assertEquals("14:30", request.time)
        assertEquals("Paid in cash", request.note)
        val plain = form(note = "   ").request()!!
        assertNull(plain.time)
        assertNull(plain.note)
    }

    @Test
    fun aNoteIsNeverLongerThanTheServiceTakes() {
        assertEquals(2_000, form(note = "x".repeat(2_500)).request()!!.note!!.length)
    }

    @Test
    fun theAmountIsCheckedAsTheEditorChecksAmounts() {
        assertEquals(listOf(PaymentProblem.AmountMissing), form(amount = "").problems())
        assertEquals(listOf(PaymentProblem.AmountInvalid), form(amount = "12abc").problems())
        assertEquals(listOf(PaymentProblem.AmountTooPrecise), form(amount = "1.234").problems())
        assertEquals(listOf(PaymentProblem.AmountZero), form(amount = "0").problems())
        assertEquals(listOf(PaymentProblem.AmountTooLarge), form(amount = "99999999999999999").problems())
    }

    @Test
    fun anAccountAndACategoryAreRequired() {
        assertEquals(listOf(PaymentProblem.AccountMissing), form(accountId = null).problems())
        assertEquals(listOf(PaymentProblem.CategoryMissing), form(categoryId = null).problems())
        assertEquals(listOf(PaymentProblem.AccountMissing, PaymentProblem.CategoryMissing), form(accountId = null, categoryId = null).problems())
    }

    @Test
    fun aTipNeedsItsOwnCategory() {
        assertEquals(listOf(PaymentProblem.TipCategoryMissing), form(amount = "460.00").problems())
        assertTrue(form(amount = "460.00", tipCategoryId = "c2").problems().isEmpty())
        assertTrue(form(amount = "450.00").problems().isEmpty())
    }

    @Test
    fun aFormWithAProblemSendsNothing() {
        assertNull(form(amount = "").request())
        assertNull(form(accountId = null).request())
        assertNull(form(amount = "460.00").request())
        assertNotNull(form().request())
    }

    @Test
    fun theExtraOverWhatIsOutstandingIsTheTip() {
        assertEquals(Split(settle = 45_000, tip = 0), splitExtra(45_000, outstanding = 45_000))
        assertEquals(Split(settle = 100, tip = 0), splitExtra(100, outstanding = 45_000))
        assertEquals(Split(settle = 45_000, tip = 1), splitExtra(45_001, outstanding = 45_000))
        assertEquals(Split(settle = 45_000, tip = 5_000), splitExtra(50_000, outstanding = 45_000))
    }

    @Test
    fun theFormKnowsItsSplitAndItsTipOnlyOnceTheAmountIsValid() {
        assertEquals(Split(45_000, 1_025), form(amount = "460.25").split)
        assertEquals(1_025L, form(amount = "460.25").tipMinor)
        assertNull(form(amount = "abc").split)
        assertEquals(0L, form(amount = "abc").tipMinor)
        assertEquals(0L, form(amount = "10").tipMinor)
    }
}
