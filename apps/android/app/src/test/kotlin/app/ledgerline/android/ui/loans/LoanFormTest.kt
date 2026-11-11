package app.ledgerline.android.ui.loans

import app.ledgerline.api.LoanMove
import app.ledgerline.api.Money
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Lend, Borrow and Repay form as plain data (ADR 0050, slice 6): what it starts with, what is wrong with it, what it sends. */
class LoanFormTest {
    private val sam = LoanWho("sam", "Sam Rivera")
    private val checking = LoanAccount("a-checking", "Everyday checking", "USD")
    private val savings = LoanAccount("a-savings", "Savings", "USD")
    private val euro = LoanAccount("a-euro", "Euro account", "EUR")
    private val yen = LoanAccount("a-yen", "Yen account", "JPY")
    private val accounts = listOf(checking, savings, euro, yen)

    private fun lend(amount: String = "50.00", accountId: String? = "a-checking", note: String = "") =
        LoanForm.start(sam, LoanKind.Lend, emptyList(), accounts, today = "2026-11-11").copy(amount = amount, accountId = accountId, note = note)

    private fun repay(open: List<OpenLoan>, amount: String = "20.00", accountId: String? = null, currency: String? = null) =
        LoanForm.start(sam, LoanKind.Repay, open, accounts, today = "2026-11-11").copy(amount = amount, accountId = accountId, chosenCurrency = currency)

    private val theyOweUsd = OpenLoan("USD", 10_000)
    private val iOweUsd = OpenLoan("USD", -10_000)
    private val theyOweEur = OpenLoan("EUR", 4_000)

    @Test
    fun aNewFormStartsEmptyOnTodayWithNoNote() {
        val start = LoanForm.start(sam, LoanKind.Lend, emptyList(), accounts, today = "2026-11-11")
        assertEquals("", start.amount)
        assertEquals("2026-11-11", start.date)
        assertEquals("", start.note)
        assertNull(start.accountId)
    }

    @Test
    fun aRepaymentAmountStartsEmptyEvenWhenSomethingIsOpen() {
        assertEquals("", LoanForm.start(sam, LoanKind.Repay, listOf(theyOweUsd), accounts, today = "2026-11-11").amount)
    }

    @Test
    fun withNoAccountChosenTheFirstOfferedOneIsUsedAsTheWebDoes() {
        assertEquals(checking, lend(accountId = null).account)
        assertEquals(savings, lend(accountId = "a-savings").account)
        // One that is not offered any more is ignored.
        assertEquals(checking, lend(accountId = "gone").account)
    }

    @Test
    fun lendingAndBorrowingOfferEveryAccountInAnyCurrency() {
        assertEquals(accounts, lend().usable)
        assertEquals(accounts, LoanForm.start(sam, LoanKind.Borrow, emptyList(), accounts, "2026-11-11").usable)
    }

    @Test
    fun theAmountOfALendIsInTheCurrencyOfTheAccount() {
        assertEquals("USD", lend().amountCurrency)
        assertEquals("EUR", lend(accountId = "a-euro").amountCurrency)
        assertEquals(Money(5_050, "EUR"), lend(amount = "50.50", accountId = "a-euro").request()!!.amount)
        assertEquals(Money(50, "JPY"), lend(amount = "50", accountId = "a-yen").request()!!.amount)
        assertEquals(listOf(LoanProblem.AmountTooPrecise), lend(amount = "50.5", accountId = "a-yen").problems())
    }

    @Test
    fun aLendWithNoAccountsAtAllIsToldToChooseOne() {
        val form = LoanForm.start(sam, LoanKind.Lend, emptyList(), emptyList(), "2026-11-11").copy(amount = "5")
        assertEquals(listOf(LoanProblem.AccountMissing), form.problems())
        assertNull(form.request())
        assertEquals("USD", form.amountCurrency)
    }

    @Test
    fun theBodyIsExactlyWhatTheWebSends() {
        assertEquals(
            LoanMove(accountId = "a-checking", amount = Money(5_000, "USD"), date = "2026-11-11", time = null, note = null),
            lend().request(),
        )
        assertEquals("Lunch", lend(note = "  Lunch  ").request()!!.note)
        assertNull(lend(note = "   ").request()!!.note)
        assertEquals(2_000, lend(note = "x".repeat(2_500)).request()!!.note!!.length)
    }

    @Test
    fun anAmountThatIsMissingWrongOrZeroIsSaidAndNothingIsSent() {
        assertEquals(listOf(LoanProblem.AmountMissing), lend(amount = "").problems())
        assertEquals(listOf(LoanProblem.AmountInvalid), lend(amount = "abc").problems())
        assertEquals(listOf(LoanProblem.AmountTooPrecise), lend(amount = "1.234").problems())
        assertEquals(listOf(LoanProblem.AmountZero), lend(amount = "0").problems())
        assertEquals(listOf(LoanProblem.AmountTooLarge), lend(amount = "90071992547409.92").problems())
        assertNull(lend(amount = "").request())
        assertTrue(lend().problems().isEmpty())
    }

    @Test
    fun theAmountAcceptsAPointOrACommaAndALeadingOrTrailingPoint() {
        assertEquals(Money(80, "USD"), lend(amount = ".8").request()!!.amount)
        assertEquals(Money(800, "USD"), lend(amount = "8.").request()!!.amount)
        assertEquals(Money(1_550, "USD"), lend(amount = "15,5").request()!!.amount)
    }

    @Test
    fun theAccountIsReceivingWhenBorrowingOrWhenTheyOweYouAndPayingOtherwise() {
        assertFalse(lend().accountReceives)
        assertTrue(LoanForm.start(sam, LoanKind.Borrow, emptyList(), accounts, "2026-11-11").accountReceives)
        assertTrue(repay(listOf(theyOweUsd)).accountReceives)
        assertFalse(repay(listOf(iOweUsd)).accountReceives)
    }

    @Test
    fun repayingOffersOnlyAccountsInTheLoansCurrency() {
        assertEquals(listOf(checking, savings), repay(listOf(theyOweUsd)).usable)
        assertEquals(listOf(euro), repay(listOf(theyOweEur)).usable)
        assertEquals("EUR", repay(listOf(theyOweEur)).amountCurrency)
    }

    @Test
    fun repayingStartsInTheFirstOpenCurrencyAndAsksForACurrencyOnlyWithSeveral() {
        val both = listOf(theyOweUsd, theyOweEur)
        assertEquals("USD", repay(both).currency)
        assertEquals(listOf("USD", "EUR"), repay(both).currencyChoices)
        assertEquals("EUR", repay(both, currency = "EUR").currency)
        assertEquals(emptyList<String>(), repay(listOf(theyOweUsd)).currencyChoices)
        assertEquals(emptyList<String>(), lend().currencyChoices)
    }

    @Test
    fun aChosenCurrencyThatIsNotOpenIsIgnored() {
        assertEquals("USD", repay(listOf(theyOweUsd, theyOweEur), currency = "GBP").currency)
    }

    @Test
    fun choosingAnotherCurrencyForgetsTheAccountAndKeepsWhatWasTyped() {
        val both = listOf(theyOweUsd, theyOweEur)
        val form = repay(both, amount = "12.00", accountId = "a-savings")
        assertEquals(savings, form.account)
        val moved = form.withCurrency("EUR")
        assertEquals("EUR", moved.currency)
        assertNull(moved.accountId)
        assertEquals(euro, moved.account)
        assertEquals("12.00", moved.amount)
    }

    @Test
    fun repayingMoreThanIsOpenIsRefusedAndExactlyWhatIsOpenIsNot() {
        assertEquals(listOf(LoanProblem.MoreThanOpen), repay(listOf(theyOweUsd), amount = "100.01").problems())
        assertTrue(repay(listOf(theyOweUsd), amount = "100.00").problems().isEmpty())
        assertEquals(listOf(LoanProblem.MoreThanOpen), repay(listOf(iOweUsd), amount = "100.01").problems())
        assertTrue(repay(listOf(iOweUsd), amount = "100.00").problems().isEmpty())
    }

    @Test
    fun theLimitIsTheOneOfTheCurrencyBeingRepaid() {
        val both = listOf(theyOweUsd, theyOweEur)
        assertTrue(repay(both, amount = "100.00").problems().isEmpty())
        assertEquals(listOf(LoanProblem.MoreThanOpen), repay(both, amount = "100.00", currency = "EUR").problems())
        assertTrue(repay(both, amount = "40.00", currency = "EUR").problems().isEmpty())
    }

    @Test
    fun repayingWithNothingOpenCannotBeSaved() {
        // Nothing is open and so no currency to offer an account in; the sheet never opens this way.
        assertEquals(listOf(LoanProblem.MoreThanOpen, LoanProblem.AccountMissing), repay(emptyList(), amount = "1").problems())
    }

    @Test
    fun repayingWithNoAccountInThatCurrencyIsToldToChooseOne() {
        val form = LoanForm.start(sam, LoanKind.Repay, listOf(OpenLoan("GBP", 500)), accounts, "2026-11-11").copy(amount = "1.00")
        assertEquals(listOf(LoanProblem.AccountMissing), form.problems())
    }

    @Test
    fun aRepaymentSendsTheMoveInTheLoansCurrency() {
        val request = repay(listOf(theyOweEur), amount = "15.50").request()!!
        assertEquals(LoanMove("a-euro", Money(1_550, "EUR"), "2026-11-11"), request)
    }

    @Test
    fun theBalanceAndWhoOwesWhomComeFromTheLoanBeingRepaid() {
        val form = repay(listOf(theyOweUsd, OpenLoan("EUR", -2_500)))
        assertEquals(10_000L, form.balance)
        assertTrue(form.owedToYou)
        val euros = form.withCurrency("EUR")
        assertEquals(-2_500L, euros.balance)
        assertFalse(euros.owedToYou)
    }
}
