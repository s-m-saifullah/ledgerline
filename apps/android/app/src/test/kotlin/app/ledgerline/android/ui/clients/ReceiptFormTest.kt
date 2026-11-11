package app.ledgerline.android.ui.clients

import app.ledgerline.api.CreateReceipt
import app.ledgerline.api.ExpectedAllocation
import app.ledgerline.api.Money
import app.ledgerline.api.ReceiptAllocation
import app.ledgerline.api.ReceiptPreview
import app.ledgerline.api.TipInput
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Record payment form for a client as plain data (ADR 0050, slice 4c): what it starts with, what is wrong, what it sends. */
class ReceiptFormTest {
    private val target = ReceiptTarget("client-1", "Northwind Design", listOf(Money(60_000, "USD"), Money(20_000, "EUR")))

    private fun form(
        amount: String = "600.00",
        currency: String = "USD",
        accountId: String? = "a1",
        categoryId: String? = "c1",
        tipCategoryId: String? = null,
        time: String? = null,
        note: String = "",
    ) = ReceiptForm(target, currency, amount, accountId, categoryId, tipCategoryId, date = "2026-11-10", time = time, note = note)

    private fun allocation(id: String, version: Int, applied: Long, left: Long = 0) = ReceiptAllocation(
        receivableId = id, description = "Service $id", serviceDate = "2026-10-01", version = version,
        outstanding = Money(applied + left, "USD"), applied = Money(applied, "USD"), remainingAfter = Money(left, "USD"),
    )

    private fun preview(amount: Long = 60_000, currency: String = "USD", exceeds: Boolean = false, tooMany: Boolean = false, allocations: List<ReceiptAllocation> = listOf(allocation("s1", 2, 45_000), allocation("s2", 5, 15_000))) =
        ReceiptPreview("client-1", Money(amount, currency), Money(60_000, currency), exceeds, tooMany, allocations)

    @Test
    fun aNewFormStartsEmptyInTheFirstCurrencyTheyOweWithTodayAndNothingChosen() {
        val start = ReceiptForm.forClient(target, today = "2026-11-10")
        assertEquals("", start.amount)
        assertEquals("USD", start.currency)
        assertEquals("2026-11-10", start.date)
        assertNull(start.accountId)
        assertNull(start.categoryId)
        assertNull(start.tipCategoryId)
        assertNull(start.time)
        assertEquals("", start.note)
    }

    @Test
    fun theOpenTotalIsWhatTheyOweInTheChosenCurrency() {
        assertEquals(60_000, form().outstanding)
        assertEquals(20_000, form(currency = "EUR").outstanding)
        assertEquals(0, form(currency = "GBP").outstanding)
    }

    @Test
    fun payFullBalanceFillsTheAmountWithTheOpenTotalInTheCurrencysOwnDecimals() {
        assertEquals("600.00", form(amount = "").payInFull().amount)
        val yen = ReceiptTarget("client-2", "Tokyo Studio", listOf(Money(12_000, "JPY")))
        assertEquals("12000", ReceiptForm.forClient(yen, "2026-11-10").payInFull().amount)
    }

    @Test
    fun payingLessThanTheTotalAsksForThatAmountAndHasNoTip() {
        val part = form(amount = "250.00")
        assertEquals(Split(25_000, 0), part.split)
        assertEquals(25_000L, part.previewAmount)
        assertEquals(0, part.tipMinor)
    }

    @Test
    fun moneyOverTheTotalSettlesEverythingAndTheRestIsOneTip() {
        val over = form(amount = "650.00")
        assertEquals(Split(60_000, 5_000), over.split)
        // The preview is asked for what settles, never for the whole amount.
        assertEquals(60_000L, over.previewAmount)
        assertEquals(5_000, over.tipMinor)
    }

    @Test
    fun noPreviewIsAskedForWhileTheAmountIsNotAValidOne() {
        assertNull(form(amount = "").previewAmount)
        assertNull(form(amount = "abc").previewAmount)
        assertNull(form(amount = "0").previewAmount)
    }

    @Test
    fun aClientWhoOwesNothingInTheCurrencyHasNothingToPay() {
        assertTrue(ReceiptProblem.NothingOwed in form(currency = "GBP").problems())
    }

    @Test
    fun everyProblemIsFoundAtOnce() {
        assertEquals(listOf(ReceiptProblem.AmountMissing, ReceiptProblem.AccountMissing, ReceiptProblem.CategoryMissing), form(amount = "", accountId = null, categoryId = null).problems())
        assertEquals(listOf(ReceiptProblem.AmountInvalid), form(amount = "1.2.3").problems())
        assertEquals(listOf(ReceiptProblem.AmountTooPrecise), form(amount = "1.234").problems())
        assertEquals(listOf(ReceiptProblem.AmountZero), form(amount = "0").problems())
    }

    @Test
    fun aTipNeedsItsOwnCategory() {
        assertEquals(listOf(ReceiptProblem.TipCategoryMissing), form(amount = "650.00").problems())
        assertTrue(form(amount = "650.00", tipCategoryId = "c2").problems().isEmpty())
        // No tip, so the tip category is not asked for.
        assertTrue(form(amount = "600.00").problems().isEmpty())
    }

    @Test
    fun theRequestNamesExactlyWhatThePreviewShowed() {
        val request = form().request(preview())!!
        assertEquals(
            CreateReceipt(
                amount = Money(60_000, "USD"), accountId = "a1", categoryId = "c1", date = "2026-11-10", time = null, note = null, tip = null,
                expectedAllocations = listOf(ExpectedAllocation("s1", 2, 45_000), ExpectedAllocation("s2", 5, 15_000)),
            ),
            request,
        )
    }

    @Test
    fun theRequestForMoreThanIsOwedSettlesTheTotalAndCarriesOneTip() {
        val request = form(amount = "650.00", tipCategoryId = "c2").request(preview())!!
        assertEquals(Money(60_000, "USD"), request.amount)
        assertEquals(TipInput(Money(5_000, "USD"), "c2"), request.tip)
    }

    @Test
    fun timeAndNoteAreSentTrimmedAndOnlyWhenGiven() {
        val request = form(time = "09:05", note = "  Cash  ").request(preview())!!
        assertEquals("09:05", request.time)
        assertEquals("Cash", request.note)
        assertNull(form(note = "   ").request(preview())!!.note)
        assertEquals(ReceiptNoteMax, form(note = "x".repeat(ReceiptNoteMax + 50)).request(preview())!!.note!!.length)
    }

    @Test
    fun noRequestWhileAnythingIsWrongOrThePreviewIsMissingOrStale() {
        assertNull(form(accountId = null).request(preview()))
        assertNull(form().request(null))
        // The amount was changed after the preview was read.
        assertNull(form(amount = "500.00").request(preview(amount = 60_000)))
        // The preview is for another currency, another client, or says no.
        assertNull(form().request(preview(currency = "EUR")))
        assertNull(form().request(preview().copy(contactId = "client-2")))
        assertNull(form().request(preview(exceeds = true)))
        assertNull(form().request(preview(tooMany = true)))
        assertNull(form().request(preview(allocations = emptyList())))
    }

    @Test
    fun aPreviewMatchesOnlyTheAmountAndCurrencyItWasAskedFor() {
        assertTrue(form().matches(preview()))
        assertFalse(form(amount = "500.00").matches(preview()))
        assertFalse(form().matches(null))
    }

    @Test
    fun theSummaryCountsServicesPaidInFullAndWhetherOneIsPaidOnlyInPart() {
        assertEquals(PaysSummary(2, false), paysSummary(listOf(allocation("a", 1, 100), allocation("b", 1, 50))))
        assertEquals(PaysSummary(1, true), paysSummary(listOf(allocation("a", 1, 100), allocation("b", 1, 50, left = 10))))
        assertEquals(PaysSummary(0, true), paysSummary(listOf(allocation("a", 1, 10, left = 90))))
        assertEquals(PaysSummary(0, false), paysSummary(emptyList()))
    }

    @Test
    fun aClientWhoOnlyOwesEurosStartsInEuros() {
        val euros = ReceiptTarget("client-3", "Berlin Studio", listOf(Money(9_000, "EUR")))
        assertEquals("EUR", ReceiptForm.forClient(euros, "2026-11-10").currency)
    }

    @Test
    fun anAmountInACurrencyTheyOweNothingInAsksForNoPreview() {
        assertNull(form(amount = "10.00", currency = "GBP").previewAmount)
    }

    // ---- an account in another currency (ADR 0050, slice 4b-1)

    private fun across(amount: String = "600.00", received: String = "550.00", tip: String = "", tipCategoryId: String? = null, account: String = "EUR") =
        form(amount = amount, tipCategoryId = tipCategoryId).copy(accountCurrency = account, received = received, tipAmount = tip)

    @Test
    fun anAccountInTheCurrencyTheyOweInIsNotAPaymentAcrossCurrencies() {
        val same = form().copy(accountCurrency = "USD", received = "999", tipAmount = "5")
        assertNull(same.cross)
        assertNull(same.request(preview())!!.receivedAmount)
    }

    @Test
    fun anAccountInAnotherCurrencySendsWhatArrivedSharedAcrossTheServices() {
        val request = across().request(preview())!!
        assertEquals(Money(60_000, "USD"), request.amount)
        assertEquals(Money(55_000, "EUR"), request.receivedAmount)
        assertNull(request.fxRate)
        assertNull(request.tip)
    }

    @Test
    fun theAmountAskedForIsWhatWasTypedAndNeverSplitIntoATipWhenTheAccountIsInAnotherCurrency() {
        val over = across(amount = "650.00")
        assertEquals(Split(65_000, 0), over.split)
        assertEquals(65_000L, over.previewAmount)
        assertEquals(0, over.tipMinor)
    }

    @Test
    fun theTipIsTypedAndSentInTheAccountsCurrency() {
        val tipped = across(tip = "5.50", tipCategoryId = "c2")
        assertEquals(TipInput(Money(550, "EUR"), "c2"), tipped.request(preview())!!.tip)
        assertEquals(listOf(ReceiptProblem.TipCategoryMissing), across(tip = "5.50").problems())
    }

    @Test
    fun whatArrivedAndATypedTipAreCheckedLikeAnyAmount() {
        assertEquals(listOf(ReceiptProblem.ReceivedMissing), across(received = "").problems())
        assertEquals(listOf(ReceiptProblem.ReceivedInvalid), across(received = "x").problems())
        assertEquals(listOf(ReceiptProblem.ReceivedTooPrecise), across(received = "1.234").problems())
        assertEquals(listOf(ReceiptProblem.ReceivedZero), across(received = "0").problems())
        assertEquals(listOf(ReceiptProblem.ReceivedTooLarge), across(received = "99999999999999999").problems())
        assertEquals(listOf(ReceiptProblem.TipInvalid), across(tip = "abc").problems())
        assertNull(across(received = "").request(preview()))
    }

    @Test
    fun theRateSentenceFollowsTheTwoAmounts() {
        assertEquals("1 USD = 0.916667 EUR", across().rate!!.sentence)
        assertNull(across(received = "").rate)
        assertNull(form().rate)
    }

    // ---- neither side the base currency (ADR 0050, slice 4b-2)

    private val aKey = RateKey("GBP", "2026-11-10")
    private val stored = RateAnswer(aKey, StoredRate.Found("1.2658227848", "2026-11-07"))

    private fun pounds(typed: String = "", answer: RateAnswer? = stored, received: String = "170.00") =
        form(amount = "200.00", currency = "EUR").copy(accountCurrency = "GBP", received = received, rateTyped = typed, rateAnswer = answer)

    private fun euroPreview() = ReceiptPreview(
        "client-1", Money(20_000, "EUR"), Money(20_000, "EUR"), false, false,
        listOf(allocation("s9", 4, 20_000).copy(outstanding = Money(20_000, "EUR"), applied = Money(20_000, "EUR"), remainingAfter = Money(0, "EUR"))),
    )

    @Test
    fun aRateIsAskedForTheAccountsCurrencyOnThePaymentsDateOnlyWhenNeitherSideIsTheBaseCurrency() {
        assertEquals(aKey, pounds().rateKey)
        assertEquals(RateKey("GBP", "2026-11-03"), pounds().copy(date = "2026-11-03").rateKey)
        assertNull(pounds().copy(accountCurrency = "USD").rateKey)
        assertNull(pounds().copy(accountCurrency = "EUR").rateKey)
        assertNull(across().rateKey)
        assertNull(form().rateKey)
    }

    @Test
    fun aStoredRateIsNotSentButOneTypedByHandIs() {
        assertNull(pounds().request(euroPreview())!!.fxRate)
        val typed = pounds(typed = "122.5").request(euroPreview())!!
        assertEquals("0.0081632653", typed.fxRate)
        assertEquals(Money(17_000, "GBP"), typed.receivedAmount)
    }

    @Test
    fun aTypedRateIsNeverSentWhenOneSideIsTheBaseCurrency() {
        assertNull(across().copy(rateTyped = "122.5").request(preview())!!.fxRate)
        assertNull(form().copy(rateTyped = "122.5").request(preview())!!.fxRate)
    }

    @Test
    fun aTypedRateThatCannotBeStoredAndAMissingOneBlockSaving() {
        assertEquals(listOf(ReceiptProblem.RateInvalid), pounds(typed = "abc").problems())
        assertNull(pounds(typed = "abc").request(euroPreview()))
        val none = RateAnswer(aKey, StoredRate.Missing)
        assertEquals(listOf(ReceiptProblem.RateMissing), pounds(answer = none).problems())
        assertNull(pounds(answer = none).request(euroPreview()))
        assertEquals("0.0081632653", pounds(answer = none, typed = "122.5").request(euroPreview())!!.fxRate)
    }

    @Test
    fun aLookUpStillOutOrThatFailedDoesNotBlockSaving() {
        assertEquals(emptyList<ReceiptProblem>(), pounds(answer = null).problems())
        assertEquals(emptyList<ReceiptProblem>(), pounds(answer = RateAnswer(aKey, StoredRate.Unavailable)).problems())
        assertEquals(emptyList<ReceiptProblem>(), pounds(answer = RateAnswer(RateKey("GBP", "2026-11-01"), StoredRate.Missing)).problems())
    }

    @Test
    fun choosingAnotherAccountCurrencyDropsTheRateTypedForTheOldOne() {
        val typed = pounds(typed = "122.5")
        assertEquals("", typed.withAccount("a9", "CHF").rateTyped)
        assertEquals("122.5", typed.withAccount("a8", "GBP").rateTyped)
    }
}
