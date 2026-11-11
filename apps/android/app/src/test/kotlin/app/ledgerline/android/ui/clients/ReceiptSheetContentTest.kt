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
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.WriteError
import app.ledgerline.android.ui.design.Choice
import app.ledgerline.android.ui.privacy.LocalPrivacy
import app.ledgerline.api.Money
import app.ledgerline.api.ReceiptAllocation
import app.ledgerline.api.ReceiptPreview
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The Record payment sheet for a client (ADR 0050, slice 4c): what it shows, what each tap reports, the preview and the question. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class ReceiptSheetContentTest {
    @get:Rule
    val compose = createComposeRule()

    private val target = ReceiptTarget("client-1", "Northwind Design", listOf(Money(60_000, "USD")))
    private val start = ReceiptForm.forClient(target, "2026-11-10")
    private val accounts = listOf(Choice("a1", "Everyday checking", "USD"), Choice("a2", "Savings", "USD"))
    private val categories = listOf(Choice("c1", "Freelance"), Choice("c2", "Freelance › Design work"), Choice("c3", "Tips"))
    private val chosen = start.copy(amount = "600.00", accountId = "a1", categoryId = "c1")

    private fun allocation(id: String, applied: Long, left: Long = 0) = ReceiptAllocation(
        id, id, "2026-10-01", 1, Money(applied + left, "USD"), Money(applied, "USD"), Money(left, "USD"),
    )

    private fun preview(
        amount: Long = 60_000,
        exceeds: Boolean = false,
        tooMany: Boolean = false,
        allocations: List<ReceiptAllocation> = listOf(allocation("Brand refresh", 45_000), allocation("Landing copy", 15_000)),
    ) = Online.Ready(ReceiptPreview("client-1", Money(amount, "USD"), Money(60_000, "USD"), exceeds, tooMany, allocations))

    private fun ui(
        form: ReceiptForm = start,
        target: ReceiptTarget = this.target,
        read: Online<ReceiptPreview>? = null,
        other: Boolean = false,
        noIncome: Boolean = false,
        errors: Set<ReceiptProblem> = emptySet(),
        saving: Boolean = false,
        error: WriteError? = null,
        asking: Boolean = false,
    ) = ReceiptUi(form.copy(target = target), accounts, if (noIncome) emptyList() else categories, other, noIncome, read, errors, saving, error, asking)

    private class Taps(private val form: () -> ReceiptForm) {
        val log = mutableListOf<String>()
        fun actions() = ReceiptActions(
            edit = { change -> log += "edit:" + change(form()).let { "${it.amount}|${it.accountId}|${it.categoryId}|${it.tipCategoryId}" } },
            payInFull = { log += "payInFull" },
            chooseCurrency = { log += "currency:$it" },
            save = { log += "save" },
            dismissAsk = { log += "dismissAsk" },
            confirm = { log += "confirm" },
            close = { log += "close" },
        )
    }

    private fun show(ui: ReceiptUi, taps: Taps = Taps { ui.form }, private: Boolean = false) = compose.setContent {
        CompositionLocalProvider(LocalPrivacy provides private) {
            ReceiptSheetContent(ui, taps.actions(), Modifier.requiredHeight(3000.dp))
        }
    }

    @Test
    fun theSheetNamesTheClientAndWhatTheyOweAndStartsEmpty() {
        show(ui())
        compose.onNodeWithText("Record payment").assertExists()
        compose.onNodeWithText("Northwind Design").assertExists()
        compose.onNodeWithText("Open balance $600.00").assertExists()
        compose.onNodeWithText("Amount (USD)").assertExists()
        compose.onNodeWithText("Pays, oldest first", ignoreCase = true).assertDoesNotExist()
        compose.onNodeWithText("Save payment").assertIsEnabled()
    }

    @Test
    fun theOpenBalanceIsTheChosenCurrencys() {
        val both = ReceiptTarget("client-1", "Northwind Design", listOf(Money(60_000, "USD"), Money(20_000, "EUR")))
        show(ui(start.copy(currency = "EUR"), target = both))
        compose.onNodeWithText("Amount (EUR)").assertExists()
        compose.onNodeWithText("Open balance €200.00").assertExists()
    }

    @Test
    fun typingReportsWhatWasTyped() {
        val taps = Taps { start }
        show(ui(), taps)
        compose.onNode(hasSetTextAction() and hasText("Amount (USD)")).performTextReplacement("120")
        assertEquals(listOf("edit:120|null|null|null"), taps.log)
    }

    @Test
    fun payFullBalanceReports() {
        val taps = Taps { start }
        show(ui(), taps)
        compose.onNodeWithText("Pay full balance").performClick()
        assertEquals(listOf("payInFull"), taps.log)
    }

    @Test
    fun payFullBalanceIsOutlinedWhileSaveIsTheOnePrimaryAction() {
        show(ui(chosen))
        compose.onNodeWithText("Pay full balance").assertIsEnabled()
        compose.onNodeWithText("Save payment").assertIsEnabled()
    }

    @Test
    fun theCurrencyRowShowsOnlyWhenTheyOweInSeveralCurrencies() {
        show(ui())
        compose.onNodeWithText("Currency").assertDoesNotExist()
    }

    @Test
    fun withSeveralCurrenciesTheCurrencyRowOffersThemAndChoosingOneReportsIt() {
        val both = ReceiptTarget("client-1", "Northwind Design", listOf(Money(60_000, "USD"), Money(20_000, "EUR")))
        val taps = Taps { start }
        show(ui(target = both), taps)
        compose.onNodeWithText("Currency").performClick()
        compose.onNodeWithText("EUR").performClick()
        assertEquals(listOf("currency:EUR"), taps.log)
    }

    @Test
    fun theAccountAndCategoryRowsAskToChooseAndShowWhatWasChosen() {
        show(ui())
        compose.onAllNodesWithText("Choose").assertCountEquals(2)
    }

    @Test
    fun tappingTheAccountAndCategoryRowsOffersTheirChoicesAndReportsOne() {
        val taps = Taps { start }
        show(ui(), taps)
        compose.onNodeWithText("Account").performClick()
        compose.onNodeWithText("Savings").performClick()
        compose.onNodeWithText("Category").performClick()
        compose.onNodeWithText("Freelance › Design work").performClick()
        assertEquals(listOf("edit:|a2|null|null", "edit:|null|c2|null"), taps.log)
    }

    @Test
    fun theChosenAccountAndCategoryAreShown() {
        show(ui(chosen))
        compose.onNodeWithText("Everyday checking").assertExists()
        compose.onNodeWithText("Freelance").assertExists()
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
    fun theServicesTheAmountPaysAreListedOldestFirstWithWhatIsLeft() {
        show(ui(chosen, read = preview()))
        compose.onNodeWithText("Pays, oldest first", ignoreCase = true).assertExists()
        compose.onNodeWithText("Brand refresh").assertExists()
        compose.onNodeWithText("Landing copy").assertExists()
        compose.onAllNodesWithText("Paid in full").assertCountEquals(2)
        compose.onNodeWithText("$450.00").assertExists()
        compose.onNodeWithText("Pays 2 services in full.").assertExists()
    }

    @Test
    fun aPartialPaymentSaysWhatIsLeftAndThatItPaysPartOfOneMore() {
        show(ui(chosen.copy(amount = "500.00"), read = preview(50_000, allocations = listOf(allocation("Brand refresh", 45_000), allocation("Landing copy", 5_000, left = 10_000)))))
        compose.onNodeWithText("$100.00 left").assertExists()
        compose.onNodeWithText("Paid in full").assertExists()
        compose.onNodeWithText("Pays 1 service in full and part of one more.").assertExists()
    }

    @Test
    fun anAmountThatDoesNotFinishTheFirstServiceSaysItPaysPartOfOne() {
        show(ui(chosen.copy(amount = "100.00"), read = preview(10_000, allocations = listOf(allocation("Brand refresh", 10_000, left = 35_000)))))
        compose.onNodeWithText("$350.00 left").assertExists()
        compose.onNodeWithText("Pays part of one service.").assertExists()
    }

    @Test
    fun paysOneServiceInFullSaysServiceNotServices() {
        show(ui(chosen.copy(amount = "450.00"), read = preview(45_000, allocations = listOf(allocation("Brand refresh", 45_000)))))
        compose.onNodeWithText("Pays 1 service in full.").assertExists()
    }

    @Test
    fun whileTheServicesAreBeingReadTheSheetSaysSo() {
        show(ui(chosen, read = Online.Loading))
        compose.onNodeWithText("Checking open services…").assertExists()
        compose.onNodeWithText("Pays, oldest first", ignoreCase = true).assertDoesNotExist()
    }

    @Test
    fun aReadThatFailedSaysSaveTriesAgain() {
        show(ui(chosen, read = Online.Offline))
        compose.onNodeWithText("Could not check which services this pays. Save tries again.").assertExists()
    }

    @Test
    fun aReadThatFailedWithAnErrorSaysTheSame() {
        show(ui(chosen, read = Online.Failed))
        compose.onNodeWithText("Could not check which services this pays. Save tries again.").assertExists()
    }

    @Test
    fun anAmountOverTheOpenBalanceTheServerFoundIsSaidWithTheBalance() {
        show(ui(chosen, read = preview(exceeds = true)))
        compose.onNodeWithText("That is more than the open balance of $600.00.").assertExists()
        compose.onNodeWithText("Pays, oldest first", ignoreCase = true).assertDoesNotExist()
    }

    @Test
    fun anAmountThatWouldTouchTooManyServicesIsToldToBeSmaller() {
        show(ui(chosen, read = preview(tooMany = true)))
        compose.onNodeWithText("This would cover more than 100 services. Record a smaller payment first.").assertExists()
    }

    @Test
    fun savingBeforeTheServicesMatchSaysToWait() {
        show(ui(chosen, read = Online.Loading, errors = setOf(ReceiptProblem.PreviewNotReady)))
        compose.onNodeWithText("Wait for the services above to match the amount.").assertExists()
    }

    @Test
    fun problemsAreSaidNextToTheirFields() {
        show(ui(errors = setOf(ReceiptProblem.AccountMissing, ReceiptProblem.CategoryMissing)))
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
        show(ui(start.copy(amount = ""), errors = setOf(ReceiptProblem.AmountMissing)))
        compose.onNodeWithText("Enter an amount.").assertExists()
    }

    @Test
    fun moneyOverTheOpenBalanceShowsTheTipLineAndAsksForItsCategory() {
        show(ui(chosen.copy(amount = "650.00"), errors = setOf(ReceiptProblem.TipCategoryMissing)))
        compose.onNodeWithText("This settles $600.00. The extra $50.00 is saved as a tip.").assertExists()
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
    fun theHintsAboutOtherCurrenciesAndMissingIncomeCategoriesShowOnlyWhenTheyApply() {
        show(ui(other = true, noIncome = true))
        compose.onNodeWithText("Accounts in other currencies: use the web for now.").assertExists()
        compose.onNodeWithText("There are no income categories yet. Add one on the web.").assertExists()
    }

    @Test
    fun noHintShowsWhenNothingApplies() {
        show(ui())
        compose.onNodeWithText("Accounts in other currencies", substring = true).assertDoesNotExist()
        compose.onNodeWithText("no income categories", substring = true).assertDoesNotExist()
    }

    @Test
    fun theDateTimeAndNoteAreFoldedAwayUntilAsked() {
        show(ui(chosen))
        compose.onNodeWithText("Date, time and note").assertExists()
        compose.onNodeWithText("Note").assertDoesNotExist()
        compose.onNodeWithText("Date, time and note").performClick()
        compose.onNodeWithText("Note").assertExists()
        compose.onNodeWithText("When").assertExists()
    }

    @Test
    fun whileSavingNothingCanBeSentAgain() {
        show(ui(chosen, saving = true))
        compose.onNodeWithText("Save payment").assertIsNotEnabled()
        compose.onNodeWithText("Pay full balance").assertIsNotEnabled()
    }

    @Test
    fun eachWayAWriteCanFailHasItsOwnSentence() {
        val sentences = mapOf<WriteError, String>(
            WriteError.Offline to "Needs a connection. What you entered is kept.",
            WriteError.Forbidden to "Your account can't record payments in this ledger.",
            WriteError.Failed to "Couldn't record the payment. Try again.",
            WriteError.Rejected(null) to "The server didn't accept this payment.",
            WriteError.Rejected("A service changed. Reload and try again.") to "A service changed. Reload and try again.",
        )
        var shown by mutableStateOf<WriteError>(WriteError.Failed)
        compose.setContent { ReceiptSheetContent(ui(chosen, error = shown), Taps { chosen }.actions(), Modifier.requiredHeight(3000.dp)) }
        sentences.forEach { (error, sentence) ->
            shown = error
            compose.waitForIdle()
            compose.onNodeWithText(sentence).assertExists()
        }
    }

    @Test
    fun theQuestionNamesTheAmountTheClientTheAccountAndWhichServicesItPays() {
        val taps = Taps { chosen }
        show(ui(chosen, read = preview(), asking = true), taps)
        compose.onNodeWithText("Record payment?").assertExists()
        compose.onNodeWithText("Record $600.00 from Northwind Design into Everyday checking.").assertExists()
        compose.onAllNodesWithText("Pays 2 services in full.").assertCountEquals(2)
        compose.onNodeWithText("saved as a tip", substring = true).assertDoesNotExist()
        assertEquals(emptyList<String>(), taps.log)
    }

    @Test
    fun theQuestionSaysPartOfOneMoreAndHowMuchOfItIsATip() {
        val form = chosen.copy(amount = "650.00", tipCategoryId = "c3")
        show(ui(form, read = preview(allocations = listOf(allocation("Brand refresh", 45_000), allocation("Landing copy", 15_000))), asking = true))
        compose.onNodeWithText("Record $650.00 from Northwind Design into Everyday checking.").assertExists()
        compose.onNodeWithText("$50.00 of it is saved as a tip.").assertExists()
    }

    @Test
    fun yesSendsAndCancelWithdrawsTheQuestion() {
        val taps = Taps { chosen }
        show(ui(chosen, read = preview(), asking = true), taps)
        compose.onNode(hasText("Record") and hasAnyAncestor(isDialog())).performClick()
        compose.onNode(hasText("Cancel") and hasAnyAncestor(isDialog())).performClick()
        assertEquals(listOf("confirm", "dismissAsk"), taps.log)
    }

    @Test
    fun withNoQuestionThereIsNoDialog() {
        show(ui(chosen, read = preview()))
        compose.onNodeWithText("Record payment?").assertDoesNotExist()
    }

    @Test
    fun theSheetHidesEveryAmountInPrivacyMode() {
        show(ui(chosen.copy(amount = "650.00"), read = preview(), asking = true), private = true)
        compose.onNodeWithText("$600.00", substring = true).assertDoesNotExist()
        compose.onNodeWithText("$450.00", substring = true).assertDoesNotExist()
        compose.onNodeWithText("$50.00", substring = true).assertDoesNotExist()
        compose.onNodeWithText("Northwind Design", substring = true).assertExists()
    }
}
