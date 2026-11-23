package app.ledgerline.android.ui.editor

import app.ledgerline.android.ui.clients.PaymentProblem
import app.ledgerline.android.ui.clients.ReceiptProblem
import app.ledgerline.android.ui.clients.ServiceProblem
import app.ledgerline.android.ui.loans.LoanProblem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** What is wrong with a typed amount is worked out once; each form words it with its own problem. */
class AmountIssueTest {
    private fun issueOf(text: String) = parseAmount(text, "USD").issue()

    @Test
    fun eachWayAnAmountCanBeWrongHasItsOwnIssue() {
        assertEquals(AmountIssue.Missing, issueOf(""))
        assertEquals(AmountIssue.Invalid, issueOf("12abc"))
        assertEquals(AmountIssue.TooPrecise, issueOf("1.234"))
        assertEquals(AmountIssue.Zero, issueOf("0"))
        assertEquals(AmountIssue.TooLarge, issueOf("99999999999999999"))
        assertNull(issueOf("12.50"))
    }

    @Test
    fun everyFormHasAProblemForEveryIssue() {
        AmountIssue.entries.forEach { issue ->
            assertEquals("Amount${issue.name}", issue.amountProblem<PaymentProblem>().name)
            assertEquals("Amount${issue.name}", issue.amountProblem<ReceiptProblem>().name)
            assertEquals("Amount${issue.name}", issue.amountProblem<ServiceProblem>().name)
            assertEquals("Amount${issue.name}", issue.amountProblem<LoanProblem>().name)
            assertEquals("Amount${issue.name}", issue.amountProblem<FormError>().name)
        }
    }

    @Test
    fun aValidAmountHasNoProblem() {
        assertNull(parseAmount("12.50", "USD").amountProblem<PaymentProblem>())
    }

    @Test
    fun everyIssueHasItsWords() {
        assertEquals(AmountIssue.entries.size, AmountIssue.entries.map { it.messageRes() }.toSet().size)
    }

    @Test
    fun aTypedDecimalIsReadAsMeant() {
        assertEquals("0.8", readTypedDecimal(".8"))
        assertEquals("8", readTypedDecimal("8."))
        assertEquals("12.5", readTypedDecimal("12.5"))
        assertEquals("0", readTypedDecimal("."))
    }
}
