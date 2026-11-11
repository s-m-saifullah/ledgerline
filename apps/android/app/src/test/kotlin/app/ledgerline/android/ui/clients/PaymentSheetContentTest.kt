package app.ledgerline.android.ui.clients

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
import app.ledgerline.android.ui.design.Choice
import app.ledgerline.android.ui.privacy.LocalPrivacy
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The Record payment sheet's content (ADR 0050): what it shows, what each tap reports, and the question before it sends. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class PaymentSheetContentTest {
    @get:Rule
    val compose = createComposeRule()

    private val target = PaymentTarget("logo-refresh", 1, "Logo refresh", "Northwind Design", "USD", 45_000)
    private val start = PaymentForm.forService(target, "2026-11-09")
    private val accounts = listOf(Choice("a1", "Everyday checking", "USD"), Choice("a2", "Savings", "USD"))
    private val categories = listOf(Choice("c1", "Freelance"), Choice("c2", "Freelance › Design work"), Choice("c3", "Tips"))

    private fun ui(
        form: PaymentForm = start,
        other: Boolean = false,
        noIncome: Boolean = false,
        errors: Set<PaymentProblem> = emptySet(),
        saving: Boolean = false,
        error: WriteError? = null,
        asking: Boolean = false,
        accounts: List<Choice> = this.accounts,
    ) = PaymentUi(form, accounts, if (noIncome) emptyList() else categories, other, noIncome, errors, saving, error, asking)

    private class Taps(private val form: () -> PaymentForm) {
        val log = mutableListOf<String>()

        /** What each edit would make of the form. */
        val forms = mutableListOf<PaymentForm>()
        fun actions() = PaymentActions(
            edit = { change -> log += "edit:" + change(form()).also { forms += it }.let { "${it.amount}|${it.accountId}|${it.categoryId}|${it.tipCategoryId}" } },
            save = { log += "save" },
            dismissAsk = { log += "dismissAsk" },
            confirm = { log += "confirm" },
            close = { log += "close" },
        )
    }

    private fun show(ui: PaymentUi, taps: Taps = Taps { ui.form }, private: Boolean = false) = compose.setContent {
        CompositionLocalProvider(LocalPrivacy provides private) {
            PaymentSheetContent(ui, taps.actions(), Modifier.requiredHeight(3000.dp))
        }
    }

    private val chosen = start.copy(accountId = "a1", categoryId = "c1")

    @Test
    fun theSheetNamesTheServiceTheClientAndWhatIsOutstandingAndStartsWithTheFullAmount() {
        show(ui())
        compose.onNodeWithText("Record payment").assertExists()
        compose.onNodeWithText("Logo refresh").assertExists()
        compose.onNodeWithText("Client: Northwind Design").assertExists()
        compose.onNodeWithText("Outstanding").assertExists()
        compose.onAllNodesWithText("$450.00")[0].assertExists()
        compose.onNodeWithText("450.00").assertExists()
        compose.onNodeWithText("Save payment").assertIsEnabled()
    }

    @Test
    fun theAmountIsLabelledWithTheServicesCurrency() {
        show(ui())
        compose.onNodeWithText("Amount (USD)").assertExists()
    }

    @Test
    fun typingReportsWhatWasTyped() {
        val taps = Taps { start }
        show(ui(), taps)
        compose.onNode(hasSetTextAction() and hasText("450.00")).performTextReplacement("120")
        assertEquals(listOf("edit:120|null|null|null"), taps.log)
    }

    @Test
    fun theAccountAndCategoryRowsAskToChooseAndShowWhatWasChosen() {
        show(ui())
        compose.onAllNodesWithText("Choose").assertCountEquals(2)
        compose.onNodeWithText("Account").assertExists()
        compose.onNodeWithText("Category").assertExists()
    }

    @Test
    fun theChosenAccountAndCategoryAreShown() {
        show(ui(chosen))
        compose.onNodeWithText("Everyday checking").assertExists()
        compose.onNodeWithText("Freelance").assertExists()
    }

    @Test
    fun tappingTheAccountRowOffersTheAccountsAndChoosingOneReportsIt() {
        val taps = Taps { start }
        show(ui(), taps)
        compose.onNodeWithText("Account").performClick()
        compose.onNodeWithText("Savings").performClick()
        assertEquals(listOf("edit:450.00|a2|null|null"), taps.log)
    }

    @Test
    fun tappingTheCategoryRowOffersTheIncomeCategoriesAndChoosingOneReportsIt() {
        val taps = Taps { start }
        show(ui(), taps)
        compose.onNodeWithText("Category").performClick()
        compose.onNodeWithText("Freelance › Design work").performClick()
        assertEquals(listOf("edit:450.00|null|c2|null"), taps.log)
    }

    @Test
    fun saveReportsAndCancelCloses() {
        val taps = Taps { start }
        show(ui(chosen), taps)
        compose.onNodeWithText("Save payment").performClick()
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(listOf("save", "close"), taps.log)
    }

    @Test
    fun problemsAreSaidNextToTheirFields() {
        show(ui(errors = setOf(PaymentProblem.AccountMissing, PaymentProblem.CategoryMissing)))
        compose.onNodeWithText("Choose an account.").assertExists()
        compose.onNodeWithText("Choose a category.").assertExists()
    }

    @Test
    fun anAmountThatIsNotRightIsSaidAsItIsTyped() {
        show(ui(start.copy(amount = "12abc")))
        compose.onNodeWithText("Enter a number, like 12.50.").assertExists()
    }

    @Test
    fun aBlankAmountIsNotNaggedAboutUntilSaveWasPressed() {
        show(ui(start.copy(amount = "")))
        compose.onNodeWithText("Enter an amount.").assertDoesNotExist()
    }

    @Test
    fun aBlankAmountIsSaidOnceSaveWasPressed() {
        show(ui(start.copy(amount = ""), errors = setOf(PaymentProblem.AmountMissing)))
        compose.onNodeWithText("Enter an amount.").assertExists()
    }

    @Test
    fun moneyOverWhatIsOutstandingShowsTheTipLineAndAsksForItsCategory() {
        show(ui(chosen.copy(amount = "460.25"), errors = setOf(PaymentProblem.TipCategoryMissing)))
        compose.onNodeWithText("This settles $450.00. The extra $10.25 is saved as a tip.").assertExists()
        compose.onNodeWithText("Tip category").assertExists()
        compose.onNodeWithText("Choose a category for the tip.").assertExists()
    }

    @Test
    fun withNoTipThereIsNoTipLineAndNoTipCategory() {
        show(ui(chosen))
        compose.onNodeWithText("Tip category").assertDoesNotExist()
        compose.onNodeWithText("This settles", substring = true).assertDoesNotExist()
    }

    @Test
    fun theTipLineHidesTheAmountsInPrivacyMode() {
        show(ui(chosen.copy(amount = "460.25")), private = true)
        compose.onNodeWithText("$10.25", substring = true).assertDoesNotExist()
        compose.onNodeWithText("Tip category").assertExists()
    }

    @Test
    fun theHintAboutOtherCurrenciesShowsOnlyWhenThereAreSuchAccounts() {
        show(ui(other = true))
        compose.onNodeWithText("Some accounts need a rate set by hand: use the web for now.").assertExists()
    }

    @Test
    fun noHintShowsWhenEveryAccountFits() {
        show(ui())
        compose.onNodeWithText("need a rate set by hand", substring = true).assertDoesNotExist()
    }

    @Test
    fun aLedgerWithoutAnIncomeCategoryIsToldToAddOneOnTheWeb() {
        show(ui(noIncome = true))
        compose.onNodeWithText("There are no income categories yet. Add one on the web.").assertExists()
    }

    @Test
    fun theDateTimeAndNoteAreFoldedAwayUntilAsked() {
        show(ui(chosen))
        compose.onNodeWithText("Date, time and note").assertExists()
        compose.onNodeWithText("Note").assertDoesNotExist()
        compose.onNodeWithText("When").assertDoesNotExist()
        compose.onNodeWithText("Date, time and note").performClick()
        compose.onNodeWithText("Note").assertExists()
        compose.onNodeWithText("When").assertExists()
        compose.onNodeWithText("Date, time and note").performClick()
        compose.onNodeWithText("Note").assertDoesNotExist()
    }

    @Test
    fun whileSavingNothingCanBeSentAgain() {
        show(ui(chosen, saving = true))
        compose.onNodeWithText("Save payment").assertIsNotEnabled()
    }

    @Test
    fun eachWayAWriteCanFailHasItsOwnSentence() {
        val sentences = mapOf<WriteError, String>(
            WriteError.Offline to "Needs a connection. What you entered is kept.",
            WriteError.Forbidden to "Your account can't record payments in this ledger.",
            WriteError.Failed to "Couldn't record the payment. Try again.",
            WriteError.Rejected(null) to "The server didn't accept this payment.",
            WriteError.Rejected("This service changed. Reload and try again.") to "This service changed. Reload and try again.",
        )
        var shown by mutableStateOf<WriteError>(WriteError.Failed)
        compose.setContent { PaymentSheetContent(ui(chosen, error = shown), Taps { chosen }.actions(), Modifier.requiredHeight(3000.dp)) }
        sentences.forEach { (error, sentence) ->
            shown = error
            compose.waitForIdle()
            compose.onNodeWithText(sentence).assertExists()
        }
    }

    @Test
    fun theQuestionNamesTheAmountTheClientAndTheAccountAndSendsNothingByItself() {
        val taps = Taps { chosen }
        show(ui(chosen, asking = true), taps)
        compose.onNodeWithText("Record payment?").assertExists()
        compose.onNodeWithText("Record $450.00 from Northwind Design into Everyday checking.").assertExists()
        compose.onNodeWithText("saved as a tip", substring = true).assertDoesNotExist()
        assertEquals(emptyList<String>(), taps.log)
    }

    @Test
    fun theQuestionSaysHowMuchOfItIsATip() {
        show(ui(chosen.copy(amount = "460.25", tipCategoryId = "c3"), asking = true))
        compose.onNodeWithText("Record $460.25 from Northwind Design into Everyday checking.").assertExists()
        compose.onNodeWithText("$10.25 of it is saved as a tip.").assertExists()
    }

    @Test
    fun yesSendsAndCancelWithdrawsTheQuestion() {
        val taps = Taps { chosen }
        show(ui(chosen, asking = true), taps)
        compose.onNode(hasText("Record") and hasAnyAncestor(isDialog())).performClick()
        compose.onNode(hasText("Cancel") and hasAnyAncestor(isDialog())).performClick()
        assertEquals(listOf("confirm", "dismissAsk"), taps.log)
    }

    @Test
    fun theQuestionHidesTheAmountsInPrivacyMode() {
        show(ui(chosen, asking = true), private = true)
        compose.onNodeWithText("$450.00", substring = true).assertDoesNotExist()
        compose.onNodeWithText("Northwind Design", substring = true).assertExists()
    }

    @Test
    fun withNoQuestionThereIsNoDialog() {
        show(ui(chosen))
        compose.onNodeWithText("Record payment?").assertDoesNotExist()
    }

    // ---- an account in another currency (ADR 0050, slice 4b-1)

    private val euro = Choice("e1", "Euro account", "EUR")
    private val withEuro = accounts + euro
    private val across = chosen.copy(accountId = "e1", accountCurrency = "EUR", received = "410.00")

    @Test
    fun anAccountInAnotherCurrencyAsksWhatArrivedInIt() {
        show(ui(across, accounts = withEuro))
        compose.onNodeWithText("Amount received (EUR)").assertExists()
        compose.onNodeWithText("410.00").assertExists()
    }

    @Test
    fun anAccountInTheServicesCurrencyAsksNothingAboutWhatArrived() {
        show(ui(chosen.copy(accountCurrency = "USD")))
        compose.onNodeWithText("Amount received", substring = true).assertDoesNotExist()
    }

    @Test
    fun theRateTheTwoAmountsFixIsSaidUnderWhatArrived() {
        show(ui(across, accounts = withEuro))
        compose.onNodeWithText("1 USD = 0.911111 EUR").assertExists()
    }

    @Test
    fun noRateIsSaidWhileWhatArrivedIsMissing() {
        show(ui(across.copy(received = ""), accounts = withEuro))
        compose.onNodeWithText("1 USD =", substring = true).assertDoesNotExist()
    }

    @Test
    fun typingWhatArrivedReportsIt() {
        val taps = Taps { across }
        show(ui(across, accounts = withEuro), taps)
        compose.onNode(hasSetTextAction() and hasText("Amount received (EUR)")).performTextReplacement("400")
        assertEquals("400", taps.forms.single().received)
    }

    @Test
    fun whatArrivedIsNotNaggedAboutUntilSaveWasPressedAndThenIsSaid() {
        show(ui(across.copy(received = ""), accounts = withEuro))
        compose.onNodeWithText("Enter an amount.").assertDoesNotExist()
    }

    @Test
    fun aMissingAmountReceivedIsSaidOnceSaveWasPressed() {
        show(ui(across.copy(received = ""), accounts = withEuro, errors = setOf(PaymentProblem.ReceivedMissing)))
        compose.onNodeWithText("Enter an amount.").assertExists()
    }

    @Test
    fun anAmountReceivedThatIsNotRightIsSaidAsItIsTyped() {
        show(ui(across.copy(received = "4x"), accounts = withEuro))
        compose.onNodeWithText("Enter a number, like 12.50.").assertExists()
    }

    @Test
    fun moneyOverWhatIsOutstandingIsNotCalledATipWhenTheAccountIsInAnotherCurrency() {
        show(ui(across.copy(amount = "460.25"), accounts = withEuro))
        compose.onNodeWithText("This settles", substring = true).assertDoesNotExist()
        compose.onNodeWithText("Tip category").assertDoesNotExist()
    }

    @Test
    fun theTipFieldIsInTheFoldInTheAccountsCurrencyAndAsksForItsCategoryOnceTyped() {
        show(ui(across.copy(tipAmount = "5.50", tipCategoryId = null), accounts = withEuro, errors = setOf(PaymentProblem.TipCategoryMissing)))
        compose.onNodeWithText("Tip (EUR, optional)").assertDoesNotExist()
        compose.onNodeWithText("Tip, date, time and note").performClick()
        compose.onNodeWithText("Tip (EUR, optional)").assertExists()
        compose.onNodeWithText("Tip category").assertExists()
        compose.onNodeWithText("Choose a category for the tip.").assertExists()
    }

    @Test
    fun withoutAnotherCurrencyTheFoldHasNoTipField() {
        show(ui(chosen.copy(accountCurrency = "USD")))
        compose.onNodeWithText("Date, time and note").performClick()
        compose.onNodeWithText("Tip (", substring = true).assertDoesNotExist()
    }

    @Test
    fun aTipThatIsNotRightIsSaid() {
        show(ui(across.copy(tipAmount = "abc"), accounts = withEuro))
        compose.onNodeWithText("Tip, date, time and note").performClick()
        compose.onNodeWithText("Enter a tip like 2.50, or leave it empty.").assertExists()
    }

    @Test
    fun choosingAnAccountReportsItsCurrencyToo() {
        val taps = Taps { start }
        show(ui(accounts = withEuro), taps)
        compose.onNodeWithText("Account").performClick()
        compose.onNodeWithText("Euro account").performClick()
        assertEquals("EUR", taps.forms.single().accountCurrency)
        assertEquals("e1", taps.forms.single().accountId)
    }

    @Test
    fun theQuestionNamesWhatArrivedInTheAccountAndWhatItSettles() {
        show(ui(across, accounts = withEuro, asking = true))
        compose.onNodeWithText("Record €410.00 from Northwind Design into Euro account. It settles $450.00.").assertExists()
        compose.onNodeWithText("A tip of", substring = true).assertDoesNotExist()
    }

    @Test
    fun theQuestionNamesATipInTheAccountsCurrency() {
        show(ui(across.copy(tipAmount = "5.50", tipCategoryId = "c3"), accounts = withEuro, asking = true))
        compose.onNodeWithText("A tip of €5.50 is saved with it.").assertExists()
    }

    @Test
    fun theQuestionAcrossCurrenciesHidesEveryAmountInPrivacyMode() {
        show(ui(across, accounts = withEuro, asking = true), private = true)
        compose.onNodeWithText("€410.00", substring = true).assertDoesNotExist()
        compose.onNodeWithText("$450.00", substring = true).assertDoesNotExist()
    }
}
