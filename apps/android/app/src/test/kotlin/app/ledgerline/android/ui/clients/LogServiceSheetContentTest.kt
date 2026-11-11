package app.ledgerline.android.ui.clients

import android.app.Application
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createComposeRule
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

/** The Log service sheet's content (ADR 0050, slice 5): what it shows, what each tap reports, and that Save is its one filled action. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, qualifiers = "en-rUS")
class LogServiceSheetContentTest {
    @get:Rule
    val compose = createComposeRule()

    private val client = ServiceClient("client-1", "Northwind Design")
    private val start = ServiceForm.forClient(client, "2026-11-11")

    private fun ui(
        form: ServiceForm = start,
        currencies: List<String> = listOf("USD"),
        errors: Set<ServiceProblem> = emptySet(),
        saving: Boolean = false,
        error: WriteError? = null,
    ) = LogServiceUi(form, currencies, errors, saving, error)

    private class Taps(private val form: () -> ServiceForm) {
        val log = mutableListOf<String>()

        /** What each edit would make of the form. */
        val forms = mutableListOf<ServiceForm>()
        fun actions() = LogServiceActions(
            edit = { change ->
                log += "edit"
                forms += change(form())
            },
            save = { log += "save" },
            close = { log += "close" },
        )
    }

    private fun show(ui: LogServiceUi, taps: Taps = Taps { ui.form }, private: Boolean = false) = compose.setContent {
        CompositionLocalProvider(LocalPrivacy provides private) {
            LogServiceSheetContent(ui, taps.actions(), Modifier.requiredHeight(3000.dp))
        }
    }

    @Test
    fun theSheetNamesTheClientAndAsksForWhatWasDoneWhenItWasAndWhatItCost() {
        show(ui())
        compose.onNodeWithText("Log service").assertExists()
        compose.onNodeWithText("Client: Northwind Design").assertExists()
        compose.onNodeWithText("Description").assertExists()
        compose.onNodeWithText("What was done").assertExists()
        compose.onNodeWithText("When").assertExists()
        compose.onNodeWithText("Nov 11, 2026").assertExists()
        compose.onNodeWithText("Due date (optional)").assertExists()
        compose.onNodeWithText("Service amount (USD)").assertExists()
        compose.onNodeWithText("Save service").assertIsEnabled()
    }

    @Test
    fun noQuestionAccountCategoryOrTipIsAsked() {
        show(ui())
        compose.onNodeWithText("Account").assertDoesNotExist()
        compose.onNodeWithText("Category").assertDoesNotExist()
        compose.onNodeWithText("Tip", substring = true).assertDoesNotExist()
    }

    @Test
    fun typingTheDescriptionReportsWhatWasTyped() {
        val taps = Taps { start }
        show(ui(), taps)
        compose.onNode(hasSetTextAction() and hasContentDescription("Description")).performTextReplacement("Logo refresh")
        assertEquals(listOf("Logo refresh"), taps.forms.map { it.description })
    }

    @Test
    fun theDescriptionIsCutAtTheLongestTheServerTakes() {
        val taps = Taps { start }
        show(ui(), taps)
        compose.onNode(hasSetTextAction() and hasContentDescription("Description")).performTextReplacement("x".repeat(2_100))
        assertEquals(2_000, taps.forms.single().description.length)
    }

    @Test
    fun typingTheAmountReportsWhatWasTyped() {
        val taps = Taps { start }
        show(ui(start.copy(amount = "12.00")), taps)
        compose.onNode(hasSetTextAction() and hasText("12.00")).performTextReplacement("450")
        assertEquals(listOf("450"), taps.forms.map { it.amount })
    }

    @Test
    fun anAmountIsLabelledWithTheChosenCurrency() {
        show(ui(start.copy(currency = "EUR"), currencies = listOf("USD", "EUR")))
        compose.onNodeWithText("Service amount (EUR)").assertExists()
    }

    @Test
    fun theCurrencyRowShowsOnlyWhenTheLedgerHasMoreThanOne() {
        show(ui())
        compose.onNodeWithText("Currency").assertDoesNotExist()
    }

    @Test
    fun withSeveralCurrenciesTheRowOffersThemAndChoosingOneReportsIt() {
        val taps = Taps { start }
        show(ui(currencies = listOf("USD", "EUR", "GBP")), taps)
        compose.onNodeWithText("Currency").performClick()
        compose.onNodeWithText("EUR").performClick()
        assertEquals(listOf("EUR"), taps.forms.map { it.currency })
    }

    @Test
    fun theChosenCurrencyIsShownOnItsRow() {
        show(ui(start.copy(currency = "GBP"), currencies = listOf("USD", "GBP")))
        compose.onNodeWithText("GBP").assertExists()
    }

    @Test
    fun aMissingDescriptionIsNotSaidBeforeSave() {
        show(ui())
        compose.onNodeWithText("Describe what was done.").assertDoesNotExist()
    }

    @Test
    fun aMissingDescriptionAndAmountAreSaidInWordsOnceSaveWasPressed() {
        show(ui(errors = setOf(ServiceProblem.DescriptionMissing, ServiceProblem.AmountMissing)))
        compose.onNodeWithText("Describe what was done.").assertExists()
        compose.onNodeWithText("Enter an amount.").assertExists()
    }

    @Test
    fun aWrongAmountIsSaidAsItIsTyped() {
        show(ui(start.copy(amount = "1.234")))
        compose.onNodeWithText("This currency does not have that many decimals.").assertExists()
    }

    @Test
    fun aMissingAmountIsNotSaidBeforeSave() {
        show(ui())
        compose.onNodeWithText("Enter an amount.").assertDoesNotExist()
    }

    @Test
    fun aTimeCanBeRemoved() {
        val taps = Taps { start.copy(serviceTime = "09:30") }
        show(ui(start.copy(serviceTime = "09:30")), taps)
        compose.onNode(hasContentDescription("Clear time")).performClick()
        assertEquals(listOf(null), taps.forms.map { it.serviceTime })
    }

    @Test
    fun theDueDateIsOptionalAndAddedFromADashedPill() {
        show(ui())
        compose.onNodeWithText("+ Add due date").assertExists()
        compose.onNode(hasContentDescription("Clear due date")).assertDoesNotExist()
    }

    @Test
    fun aDueDateIsShownWithAWayToRemoveItThatReportsNothing() {
        val taps = Taps { start.copy(dueDate = "2026-12-01") }
        show(ui(start.copy(dueDate = "2026-12-01")), taps)
        compose.onNodeWithText("Dec 1, 2026").assertExists()
        compose.onNodeWithText("+ Add due date").assertDoesNotExist()
        compose.onNode(hasContentDescription("Clear due date")).performClick()
        assertEquals(listOf(null), taps.forms.map { it.dueDate })
    }

    @Test
    fun theDueDatePickerOpensFromTheAddPill() {
        show(ui())
        compose.onNodeWithText("+ Add due date").performClick()
        compose.onNode(hasText("OK") and hasAnyAncestor(isDialog())).assertExists()
    }

    @Test
    fun theHourlyHelperIsFoldedAwayAndOpensOnATap() {
        show(ui())
        compose.onNodeWithText("Hours").assertDoesNotExist()
        compose.onNodeWithText("Paid by the hour? Work out the amount").performClick()
        compose.onNodeWithText("Hours").assertExists()
        compose.onNodeWithText("Hourly rate (USD)").assertExists()
        compose.onNodeWithText("Use this total").assertDoesNotExist()
    }

    @Test
    fun theHourlyRateIsLabelledWithTheChosenCurrency() {
        show(ui(start.copy(currency = "EUR"), currencies = listOf("USD", "EUR")))
        compose.onNodeWithText("Paid by the hour? Work out the amount").performClick()
        compose.onNodeWithText("Hourly rate (EUR)").assertExists()
    }

    @Test
    fun aGoodPairShowsHowTheTotalIsWorkedOutAndOffersToUseIt() {
        val form = start.copy(hours = "3.5", hourlyRate = "40")
        val taps = Taps { form }
        show(ui(form), taps)
        compose.onNodeWithText("Paid by the hour? Work out the amount").performClick()
        compose.onNodeWithText("3.5 h at $40.00/h = $140.00").assertExists()
        compose.onNodeWithText("Use this total").performClick()
        assertEquals("140.00", taps.forms.single().amount)
    }

    @Test
    fun usingTheTotalIsOutlinedWhileSaveIsTheOnePrimaryAction() {
        show(ui(start.copy(hours = "3.5", hourlyRate = "40")))
        compose.onNodeWithText("Paid by the hour? Work out the amount").performClick()
        compose.onNodeWithText("Use this total").assertIsEnabled()
        compose.onNodeWithText("Save service").assertIsEnabled()
    }

    private fun hourlyProblem(form: ServiceForm, words: String) {
        show(ui(form))
        compose.onNodeWithText("Paid by the hour? Work out the amount").performClick()
        compose.onNodeWithText(words).assertExists()
        compose.onNodeWithText("Use this total").assertDoesNotExist()
    }

    @Test
    fun badHoursAreSaidAndNothingIsOffered() =
        hourlyProblem(start.copy(hours = "abc", hourlyRate = "40"), "Enter hours as a number with up to two decimals, such as 3.5.")

    @Test
    fun aBadRateIsSaidAndNothingIsOffered() =
        hourlyProblem(start.copy(hours = "3.5", hourlyRate = "x"), "Enter a positive hourly rate such as 40.00.")

    @Test
    fun aTotalOutOfRangeIsSaidAndNothingIsOffered() =
        hourlyProblem(start.copy(hours = "0.01", hourlyRate = "0.01"), "That total is outside the amount range Ledgerline can store.")

    @Test
    fun inPrivacyModeTheWorkedOutAmountsAreHidden() {
        show(ui(start.copy(hours = "3.5", hourlyRate = "40")), private = true)
        compose.onNodeWithText("Paid by the hour? Work out the amount").performClick()
        compose.onNodeWithText("3.5 h at $40.00/h = $140.00").assertDoesNotExist()
        compose.onNodeWithText("Use this total").assertExists()
    }

    @Test
    fun saveReportsAndCancelReports() {
        val taps = Taps { start }
        show(ui(), taps)
        compose.onNodeWithText("Save service").performClick()
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(listOf("save", "close"), taps.log)
    }

    @Test
    fun saveIsOffWhileSending() {
        show(ui(saving = true))
        compose.onNodeWithText("Save service").assertIsNotEnabled()
    }

    private fun endsWith(error: WriteError, words: String) {
        show(ui(error = error))
        compose.onNodeWithText(words).assertExists()
    }

    @Test
    fun offlineIsSaidAndWhatWasTypedIsKept() = endsWith(WriteError.Offline, "Needs a connection. What you entered is kept.")

    @Test
    fun aViewerIsToldTheyCannotAddServices() = endsWith(WriteError.Forbidden, "Your account can't add services in this ledger.")

    @Test
    fun aFailureIsSaidWithATryAgain() = endsWith(WriteError.Failed, "Couldn't save the service. Try again.")

    @Test
    fun theServersOwnSentenceIsShown() = endsWith(WriteError.Rejected("This client was archived."), "This client was archived.")
}
