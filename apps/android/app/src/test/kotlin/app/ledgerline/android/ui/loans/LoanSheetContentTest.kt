package app.ledgerline.android.ui.loans

import android.app.Application
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.unit.dp
import app.ledgerline.android.online.WriteError
import app.ledgerline.android.ui.privacy.LocalPrivacy
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The Lend, Borrow and Repay sheet's content (ADR 0050, slice 6): what it shows, what each tap reports, and the question before it sends. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class LoanSheetContentTest {
    @get:Rule
    val compose = createComposeRule()

    private val sam = LoanWho("sam", "Sam Rivera")
    private val accounts = listOf(
        LoanAccount("a1", "Everyday checking", "USD"), LoanAccount("a2", "Savings", "USD"), LoanAccount("a3", "Euro account", "EUR"),
    )

    private fun form(kind: LoanKind, open: List<OpenLoan> = emptyList(), accounts: List<LoanAccount> = this.accounts) =
        LoanForm.start(sam, kind, open, accounts, today = "2026-11-11")

    private val lend = form(LoanKind.Lend)
    private val borrow = form(LoanKind.Borrow)
    private val owed = form(LoanKind.Repay, listOf(OpenLoan("USD", 10_000)))
    private val owing = form(LoanKind.Repay, listOf(OpenLoan("USD", -10_000)))

    private fun ui(
        form: LoanForm,
        errors: Set<LoanProblem> = emptySet(),
        saving: Boolean = false,
        error: WriteError? = null,
        asking: Boolean = false,
    ) = LoanUi(form, errors, saving, error, asking)

    private class Taps(private val form: () -> LoanForm) {
        val log = mutableListOf<String>()
        fun actions() = LoanActions(
            edit = { change -> log += "edit:" + change(form()).let { "${it.amount}|${it.account?.id}|${it.currency}|${it.note}" } },
            save = { log += "save" },
            dismissAsk = { log += "dismissAsk" },
            confirm = { log += "confirm" },
            close = { log += "close" },
        )
    }

    private fun show(ui: LoanUi, taps: Taps = Taps { ui.form }, private: Boolean = false) = compose.setContent {
        CompositionLocalProvider(LocalPrivacy provides private) {
            LoanSheetContent(ui, taps.actions(), Modifier.requiredHeight(3000.dp))
        }
    }

    private fun typed(form: LoanForm, amount: String) = form.copy(amount = amount)

    // What each kind says.

    @Test
    fun lendingHasItsTitleItsHintAndPaidFromAndLend() {
        show(ui(lend))
        compose.onNodeWithText("Lend money to Sam Rivera").assertExists()
        compose.onNodeWithText("A transfer, not spending.").assertExists()
        compose.onNodeWithText("Paid from").assertExists()
        compose.onNodeWithText("Everyday checking").assertExists()
        compose.onNodeWithText("Lend").assertIsEnabled()
        compose.onNodeWithText("Amount (USD)").assertExists()
    }

    @Test
    fun borrowingHasItsTitleItsHintAndReceivedIntoAndBorrow() {
        show(ui(borrow))
        compose.onNodeWithText("Borrow money from Sam Rivera").assertExists()
        compose.onNodeWithText("A transfer, not income.").assertExists()
        compose.onNodeWithText("Received into").assertExists()
        compose.onNodeWithText("Borrow").assertIsEnabled()
    }

    @Test
    fun aRepaymentOfWhatTheyOweYouSaysSoAndReceivesIntoTheAccount() {
        show(ui(owed))
        compose.onNodeWithText("Record a repayment").assertExists()
        compose.onNodeWithText("Sam Rivera owes you $100.00").assertExists()
        compose.onNodeWithText("Received into").assertExists()
        compose.onNodeWithText("Record repayment").assertIsEnabled()
        compose.onNodeWithText("A transfer", substring = true).assertDoesNotExist()
    }

    @Test
    fun aRepaymentOfWhatYouOweSaysSoAndPaysFromTheAccount() {
        show(ui(owing))
        compose.onNodeWithText("You owe Sam Rivera $100.00").assertExists()
        compose.onNodeWithText("Paid from").assertExists()
    }

    @Test
    fun theAmountStartsEmptyEvenForARepayment() {
        show(ui(owed))
        compose.onNode(hasSetTextAction() and hasText("100.00")).assertDoesNotExist()
    }

    @Test
    fun theAmountIsLabelledWithTheAccountsCurrency() {
        show(ui(lend.copy(accountId = "a3")))
        compose.onNodeWithText("Amount (EUR)").assertExists()
    }

    @Test
    fun theStatusLineHidesTheAmountInPrivacyMode() {
        show(ui(owed), private = true)
        compose.onNodeWithText("$100.00", substring = true).assertDoesNotExist()
        compose.onNodeWithText("Sam Rivera owes you", substring = true).assertExists()
    }

    // Typing and choosing.

    @Test
    fun typingReportsWhatWasTyped() {
        val taps = Taps { lend }
        show(ui(lend), taps)
        compose.onNode(hasSetTextAction()).performTextReplacement("12")
        assertEquals(listOf("edit:12|a1|null|"), taps.log)
    }

    @Test
    fun tappingTheAccountRowOffersTheAccountsAndChoosingOneReportsIt() {
        val taps = Taps { lend }
        show(ui(lend), taps)
        compose.onNodeWithText("Paid from").performClick()
        compose.onNodeWithText("Savings").performClick()
        assertEquals(listOf("edit:|a2|null|"), taps.log)
    }

    @Test
    fun aRepaymentOffersOnlyAccountsInTheLoansCurrency() {
        show(ui(owed))
        compose.onNodeWithText("Received into").performClick()
        compose.onNodeWithText("Savings").assertExists()
        compose.onNodeWithText("Euro account").assertDoesNotExist()
    }

    @Test
    fun noCurrencyRowForALendOrAnyRepaymentWithOneOpenLoan() {
        show(ui(owed))
        compose.onNodeWithText("Currency").assertDoesNotExist()
    }

    @Test
    fun withSeveralOpenLoansARepaymentAsksForTheCurrencyAndChoosingOneReportsIt() {
        val two = form(LoanKind.Repay, listOf(OpenLoan("USD", 10_000), OpenLoan("EUR", 4_000)))
        val taps = Taps { two }
        show(ui(two), taps)
        compose.onNodeWithText("Currency").assertExists()
        compose.onNodeWithText("USD").assertExists()
        compose.onNodeWithText("Currency").performClick()
        compose.onNodeWithText("EUR").performClick()
        assertEquals(listOf("edit:|a3|EUR|"), taps.log)
    }

    // Problems.

    @Test
    fun anAmountThatIsNotRightIsSaidAsItIsTyped() {
        show(ui(typed(lend, "12abc")))
        compose.onNodeWithText("Enter a number, like 12.50.").assertExists()
        compose.onNodeWithText("Enter an amount.").assertDoesNotExist()
    }

    @Test
    fun aBlankAmountIsNotNaggedAboutUntilSaveWasPressed() {
        show(ui(lend))
        compose.onNodeWithText("Enter an amount.").assertDoesNotExist()
    }

    @Test
    fun aBlankAmountIsSaidOnceSaveWasPressed() {
        show(ui(lend, errors = setOf(LoanProblem.AmountMissing)))
        compose.onNodeWithText("Enter an amount.").assertExists()
    }

    @Test
    fun repayingMoreThanIsOpenIsSaidAsItIsTyped() {
        show(ui(typed(owed, "100.01")))
        compose.onNodeWithText("That is more than what is open.").assertExists()
    }

    @Test
    fun exactlyWhatIsOpenIsNotAProblem() {
        show(ui(typed(owed, "100.00")))
        compose.onNodeWithText("That is more than what is open.").assertDoesNotExist()
    }

    @Test
    fun withNoAccountToChooseTheRowSaysChooseAndSaveSaysSo() {
        show(ui(form(LoanKind.Lend, accounts = emptyList()), errors = setOf(LoanProblem.AccountMissing)))
        compose.onNodeWithText("Choose").assertExists()
        compose.onNodeWithText("Choose one of your accounts.").assertExists()
    }

    // The fold, Save and the ways a write can fail.

    @Test
    fun theDateAndNoteAreFoldedAwayUntilAsked() {
        show(ui(lend))
        compose.onNodeWithText("Date and note").assertExists()
        compose.onNodeWithText("Note").assertDoesNotExist()
        compose.onNodeWithText("Date").assertDoesNotExist()
        compose.onNodeWithText("Date and note").performClick()
        compose.onNodeWithText("Note").assertExists()
        compose.onNodeWithText("Date").assertExists()
        // The web's sheet asks no time either.
        compose.onNodeWithText("Add time").assertDoesNotExist()
        compose.onNodeWithText("Date and note").performClick()
        compose.onNodeWithText("Note").assertDoesNotExist()
    }

    @Test
    fun theNoteIsReportedAndCappedAtWhatTheServerTakes() {
        val taps = Taps { lend }
        show(ui(lend), taps)
        compose.onNodeWithText("Date and note").performClick()
        // The amount is the first box that takes text, the note the second.
        compose.onAllNodes(hasSetTextAction())[1].performTextReplacement("x".repeat(2_100))
        assertEquals(listOf("edit:|a1|null|" + "x".repeat(LoanNoteMax)), taps.log)
    }

    @Test
    fun saveReportsAndCancelCloses() {
        val taps = Taps { lend }
        show(ui(lend), taps)
        compose.onNodeWithText("Lend").performClick()
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(listOf("save", "close"), taps.log)
    }

    @Test
    fun whileSavingNothingCanBeSentAgain() {
        show(ui(lend, saving = true))
        compose.onNodeWithText("Lend").assertIsNotEnabled()
    }

    @Test
    fun eachWayAWriteCanFailHasItsOwnSentence() {
        val sentences = mapOf<WriteError, String>(
            WriteError.Offline to "Needs a connection. What you entered is kept.",
            WriteError.Forbidden to "Your account can't change loans in this ledger.",
            WriteError.Failed to "Couldn't save this. Try again.",
            WriteError.Rejected(null) to "The server didn't accept this.",
            WriteError.Rejected("Nothing is owed either way.") to "Nothing is owed either way.",
        )
        var shown by mutableStateOf<WriteError>(WriteError.Failed)
        compose.setContent { LoanSheetContent(ui(lend, error = shown), Taps { lend }.actions(), Modifier.requiredHeight(3000.dp)) }
        sentences.forEach { (error, sentence) ->
            shown = error
            compose.waitForIdle()
            compose.onNodeWithText(sentence).assertExists()
        }
    }

    // The question.

    private fun asked(form: LoanForm, taps: Taps = Taps { form }, private: Boolean = false) = show(ui(form, asking = true), taps, private)

    @Test
    fun theQuestionForALendNamesTheAmountThePersonAndTheAccountAndSendsNothingByItself() {
        val taps = Taps { lend }
        asked(typed(lend, "50"), taps)
        compose.onNodeWithText("Lend money?").assertExists()
        compose.onNodeWithText("Lend $50.00 to Sam Rivera from Everyday checking.").assertExists()
        assertEquals(emptyList<String>(), taps.log)
    }

    @Test
    fun theQuestionForABorrowSaysIntoTheAccount() {
        asked(typed(borrow, "50"))
        compose.onNodeWithText("Borrow money?").assertExists()
        compose.onNodeWithText("Borrow $50.00 from Sam Rivera into Everyday checking.").assertExists()
    }

    @Test
    fun theQuestionForARepaymentSaysWhichWayTheMoneyGoes() {
        asked(typed(owed, "50"))
        compose.onNodeWithText("Record repayment?").assertExists()
        compose.onNodeWithText("Record $50.00 from Sam Rivera into Everyday checking.").assertExists()
    }

    @Test
    fun theQuestionForARepaymentYouOweSaysPaidTo() {
        asked(typed(owing, "50"))
        compose.onNodeWithText("Record $50.00 paid to Sam Rivera from Everyday checking.").assertExists()
    }

    @Test
    fun theQuestionUsesTheCurrencyOfTheAccount() {
        asked(typed(lend.copy(accountId = "a3"), "12.50"))
        compose.onNodeWithText("Lend €12.50 to Sam Rivera from Euro account.").assertExists()
    }

    @Test
    fun yesSendsAndCancelWithdrawsTheQuestion() {
        val taps = Taps { lend }
        asked(typed(lend, "50"), taps)
        compose.onNode(hasText("Lend") and hasAnyAncestor(isDialog())).performClick()
        compose.onNode(hasText("Cancel") and hasAnyAncestor(isDialog())).performClick()
        assertEquals(listOf("confirm", "dismissAsk"), taps.log)
    }

    @Test
    fun theQuestionHidesTheAmountsInPrivacyMode() {
        asked(typed(lend, "50"), private = true)
        compose.onNodeWithText("$50.00", substring = true).assertDoesNotExist()
        compose.onNode(hasText("Sam Rivera", substring = true) and hasAnyAncestor(isDialog())).assertExists()
    }

    @Test
    fun noQuestionIsShownUntilItIsAsked() {
        show(ui(typed(lend, "50")))
        compose.onAllNodesWithText("Lend money?").assertCountEquals(0)
    }
}
