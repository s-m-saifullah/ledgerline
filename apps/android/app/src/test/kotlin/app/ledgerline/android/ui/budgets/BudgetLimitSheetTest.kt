package app.ledgerline.android.ui.budgets

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
import app.ledgerline.android.ui.privacy.LocalPrivacy
import app.ledgerline.api.BudgetLine
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate

/** The Set limit sheet's content (ADR 0046): the amount, the presets, Save, Remove and what went wrong. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class BudgetLimitSheetTest {
    @get:Rule
    val compose = createComposeRule()

    private class Taps {
        val log = mutableListOf<String>()
        fun actions() = LimitActions(
            open = { log += "open:${it.name}" },
            edit = { log += "edit:$it" },
            preset = { log += "preset:$it" },
            save = { log += "save" },
            close = { log += "close" },
            askRemove = { log += "askRemove" },
            dismissRemove = { log += "dismissRemove" },
            confirmRemove = { log += "confirmRemove" },
        )
    }

    private fun ui(line: BudgetLine, text: String? = null, saving: Boolean = false, error: LimitError? = null, ask: Boolean = false): LimitUi {
        val form = LimitForm.forLine(line, "2026-10")!!
        return LimitUi(if (text == null) form else form.copy(text = text), saving, error, ask)
    }

    private val fresh = budgetLine("Fun", null, 400)
    private val existing = budgetLine("Food", 10000, 2500)

    private fun show(ui: LimitUi, taps: Taps = Taps(), private: Boolean = false) = compose.setContent {
        CompositionLocalProvider(LocalPrivacy provides private) {
            LimitSheetContent(ui, taps.actions(), Modifier.requiredHeight(3000.dp))
        }
    }

    @Test
    fun aNewLimitSaysSetLimitNamesTheCategoryAndWhatWasSpentAndHasNothingToRemove() {
        show(ui(fresh))
        compose.onNodeWithText("Set limit").assertExists()
        compose.onNodeWithText("Fun · Spent $4.00 in October 2026").assertExists()
        compose.onNodeWithText("Remove limit").assertDoesNotExist()
    }

    @Test
    fun anExistingLimitSaysEditLimitShowsItAndCanBeRemoved() {
        show(ui(existing))
        compose.onNodeWithText("Edit limit").assertExists()
        compose.onNodeWithText("100.00").assertExists()
        compose.onNodeWithText("Remove limit").assertExists()
    }

    @Test
    fun typingSendsWhatWasTyped() {
        val taps = Taps()
        show(ui(fresh), taps)
        compose.onNode(hasSetTextAction()).performTextReplacement("75")
        assertEquals(listOf("edit:75"), taps.log)
    }

    @Test
    fun thePresetsFillTheBox() {
        val taps = Taps()
        show(ui(fresh), taps)
        listOf("$50.00", "$100.00", "$150.00", "$250.00").forEach { compose.onNodeWithText(it).performClick() }
        assertEquals(listOf("preset:5000", "preset:10000", "preset:15000", "preset:25000"), taps.log)
    }

    @Test
    fun saveWaitsForAValidAmountThatIsNew() {
        show(ui(fresh))
        compose.onNodeWithText("Save").assertIsNotEnabled()
    }

    @Test
    fun saveIsOnceTheAmountIsValid() {
        val taps = Taps()
        show(ui(fresh, "75"), taps)
        compose.onNodeWithText("Save").assertIsEnabled().performClick()
        assertEquals(listOf("save"), taps.log)
    }

    @Test
    fun anUnchangedLimitCannotBeSavedAgain() {
        show(ui(existing))
        compose.onNodeWithText("Save").assertIsNotEnabled()
    }

    @Test
    fun zeroIsExplainedAndCannotBeSavedAndABlankBoxIsNotScolded() {
        show(ui(fresh, "0"))
        compose.onNodeWithText("Enter an amount above zero.").assertExists()
        compose.onNodeWithText("Save").assertIsNotEnabled()
    }

    @Test
    fun aBlankBoxHasNoMessage() {
        show(ui(fresh))
        compose.onNodeWithText("Enter an amount.").assertDoesNotExist()
    }

    @Test
    fun anAmountWithTooManyDecimalsIsExplained() {
        show(ui(fresh, "1.234"))
        compose.onNodeWithText("This currency does not have that many decimals.").assertExists()
    }

    @Test
    fun cancelCloses() {
        val taps = Taps()
        show(ui(fresh), taps)
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(listOf("close"), taps.log)
    }

    @Test
    fun eachErrorHasItsOwnSentence() {
        val sentences = mapOf<LimitError, String>(
            LimitError.Offline to "Needs a connection. Your amount is kept.",
            LimitError.Forbidden to "Your account can't change budgets.",
            LimitError.Failed to "Couldn't save. Try again.",
            LimitError.Rejected(null) to "The server didn't accept this.",
            LimitError.Rejected("This budget changed. Reload and edit it.") to "This budget changed. Reload and edit it.",
        )
        var shown by mutableStateOf<LimitError>(LimitError.Failed)
        compose.setContent { LimitSheetContent(ui(fresh, "75", error = shown), Taps().actions(), Modifier.requiredHeight(3000.dp)) }
        sentences.forEach { (error, sentence) ->
            shown = error
            compose.waitForIdle()
            compose.onNodeWithText(sentence).assertExists()
        }
    }

    @Test
    fun whileSavingNothingCanBeTapped() {
        show(ui(existing, "150", saving = true))
        compose.onNodeWithText("Save").assertIsNotEnabled()
        compose.onNodeWithText("Remove limit").assertIsNotEnabled()
    }

    @Test
    fun removeAsksFirstAndTheQuestionNamesTheCategoryAndMonth() {
        val taps = Taps()
        show(ui(existing), taps)
        compose.onNodeWithText("Remove limit").performClick()
        assertEquals(listOf("askRemove"), taps.log)
    }

    @Test
    fun theRemoveQuestionCanBeConfirmedOrDismissed() {
        val taps = Taps()
        show(ui(existing, ask = true), taps)
        compose.onNodeWithText("Remove this limit?").assertExists()
        compose.onNodeWithText("Food will have no limit for October 2026. What was spent stays.").assertExists()
        compose.onNodeWithText("Remove").performClick()
        assertEquals(listOf("confirmRemove"), taps.log)
    }

    @Test
    fun theRemoveQuestionCancels() {
        val taps = Taps()
        show(ui(existing, ask = true), taps)
        compose.onNode(hasText("Cancel") and hasAnyAncestor(isDialog())).performClick()
        assertEquals(listOf("dismissRemove"), taps.log)
    }

    @Test
    fun whatWasSpentIsMaskedUnderPrivacyMode() {
        show(ui(fresh), private = true)
        compose.onNodeWithText("Fun · Spent $4.00 in October 2026").assertDoesNotExist()
        compose.onNodeWithText("Fun · Spent", substring = true).assertExists()
    }

    private val today = LocalDate.of(2026, 10, 24)

    private fun showBudgets(state: Online<app.ledgerline.api.BudgetMonth>, taps: Taps, sheet: LimitUi? = null) = compose.setContent {
        BudgetsContent("2026-10", state, {}, {}, {}, Modifier.requiredHeight(3000.dp), today, limit = sheet, limitActions = taps.actions())
    }

    @Test
    fun aRowWithALimitOpensItAndOneWithoutShowsSetLimitAndOpensToo() {
        val taps = Taps()
        showBudgets(Online.Ready(budgetMonth(items = listOf(budgetLine("Food", 30000, 100), budgetLine("Health", null, 1000)))), taps)
        compose.onNodeWithText("+ Set limit").assertExists()
        compose.onNodeWithText("Health").performClick()
        compose.onNodeWithText("Food").performClick()
        assertEquals(listOf("open:Health", "open:Food"), taps.log)
    }

    @Test
    fun onlyRowsWithoutALimitSayPlusSetLimit() {
        showBudgets(Online.Ready(budgetMonth(items = listOf(budgetLine("Food", 30000, 100)))), Taps())
        compose.onNodeWithText("+ Set limit").assertDoesNotExist()
    }

    @Test
    fun anArchivedCategoryHasNoSetLimitAndCannotBeOpened() {
        val taps = Taps()
        showBudgets(Online.Ready(budgetMonth(items = listOf(budgetLine("Food", 30000, 100), budgetLine("Old", null, 500).copy(archived = true)))), taps)
        compose.onNodeWithText("+ Set limit").assertDoesNotExist()
        compose.onNodeWithText("Old").performClick()
        assertEquals(emptyList<String>(), taps.log)
    }

    @Test
    fun withNoBudgetsEveryRowOffersSetLimit() {
        showBudgets(Online.Ready(budgetMonth(items = listOf(budgetLine("A", null, 300), budgetLine("B", null, 200)))), Taps())
        compose.onAllNodesWithTextCount("+ Set limit", 2)
    }

    @Test
    fun aFoldedCategoryCanStillBeGivenALimit() {
        val taps = Taps()
        showBudgets(Online.Ready(budgetMonth(items = listOf(budgetLine("Food", 30000, 100), budgetLine("Housing", null, 0)))), taps)
        compose.onNodeWithText("1 category with nothing planned or spent").performClick()
        compose.onNodeWithText("Housing").performClick()
        assertEquals(listOf("open:Housing"), taps.log)
    }

    @Test
    fun anArchivedFoldedCategoryCannotBeOpened() {
        val taps = Taps()
        showBudgets(Online.Ready(budgetMonth(items = listOf(budgetLine("Food", 30000, 100), budgetLine("Gone", null, 0).copy(archived = true)))), taps)
        compose.onNodeWithText("1 category with nothing planned or spent").performClick()
        compose.onNodeWithText("Gone").performClick()
        assertEquals(emptyList<String>(), taps.log)
    }

    @Test
    fun theSheetShowsWhenOneIsOpen() {
        showBudgets(Online.Ready(budgetMonth(items = listOf(budgetLine("Fun", null, 400)))), Taps(), sheet = ui(fresh))
        compose.onNodeWithText("Set limit").assertExists()
    }

    @Test
    fun withoutHandlersRowsDoNothingAndOfferNothing() {
        compose.setContent { BudgetsContent("2026-10", Online.Ready(budgetMonth(items = listOf(budgetLine("Health", null, 1000)))), {}, {}, {}, Modifier.requiredHeight(3000.dp), today) }
        compose.onNodeWithText("+ Set limit").assertDoesNotExist()
    }
}

private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.onAllNodesWithTextCount(text: String, count: Int) =
    onAllNodesWithText(text).assertCountEquals(count)
