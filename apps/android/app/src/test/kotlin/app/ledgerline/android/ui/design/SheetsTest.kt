package app.ledgerline.android.ui.design

import android.app.Application
import androidx.compose.material3.Text
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertWidthIsAtLeast
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import app.ledgerline.android.ui.theme.LedgerlineTheme
import app.ledgerline.android.ui.theme.LightPalette
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.Rule
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The shared sheet, the actions sheet and the fold row (WP-16, part 3): what they say, report and look like. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class SheetsTest {
    @get:Rule
    val compose = createComposeRule()

    private val log = mutableListOf<String>()

    private fun actions(editEnabled: Boolean = true) = listOf(
        SheetAction("Edit", { log += "edit" }, enabled = editEnabled),
        SheetAction("Archive", { log += "archive" }),
        SheetAction("Delete", { log += "delete" }, danger = true),
    )

    private fun showActions(list: List<SheetAction> = actions()) = compose.setContent {
        LedgerlineTheme(darkTheme = false) { ActionsContent("Groceries", { log += "close" }, list) }
    }

    @Test
    fun theActionsSheetShowsItsTitleAndEveryChoice() {
        showActions()
        listOf("Groceries", "Edit", "Archive", "Delete", "Cancel").forEach { compose.onNodeWithText(it).assertIsDisplayed() }
    }

    @Test
    fun eachChoiceReportsOnlyItselfAndCancelCloses() {
        showActions()
        compose.onNodeWithText("Archive").performClick()
        assertEquals(listOf("archive"), log)
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(listOf("archive", "close"), log)
    }

    @Test
    fun everyChoiceIsAtLeastFiftySixDpTall() {
        showActions()
        // The text node is the row less its 16 dp of padding; the row itself is RowHeight.
        listOf("Edit", "Archive", "Delete").forEach { compose.onNodeWithText(it).assertHeightIsAtLeast(10.dp) }
    }

    @Test
    fun aDisabledChoiceStaysInTheListMutedAndDoesNothing() {
        showActions(actions(editEnabled = false))
        compose.onNodeWithText("Edit").assertIsDisplayed()
        compose.onNodeWithText("Edit").assertIsNotEnabled()
        compose.onNodeWithText("Edit").performClick()
        assertEquals(emptyList<String>(), log)
        assertEquals(LightPalette.muted, colorOf("Edit"))
    }

    private fun colorOf(text: String) = compose.onNodeWithText(text).fetchSemanticsNode().let { node ->
        val results = mutableListOf<TextLayoutResult>()
        node.config[SemanticsActions.GetTextLayoutResult].action!!.invoke(results)
        results.single().layoutInput.style.color
    }

    @Test
    fun aDangerChoiceIsRedAndAnOrdinaryOneIsNot() {
        showActions()
        assertEquals(LightPalette.danger, colorOf("Delete"))
        assertEquals(LightPalette.text, colorOf("Archive"))
    }

    @Test
    fun theMenuButtonIsDescribedAndAtLeastFortyEightDp() {
        compose.setContent { LedgerlineTheme(darkTheme = false) { ActionsButton("Actions for Sam", { log += "open" }) } }
        compose.onNodeWithContentDescription("Actions for Sam").assertHeightIsAtLeast(48.dp).assertWidthIsAtLeast(48.dp).performClick()
        assertEquals(listOf("open"), log)
    }

    @Test
    fun theOutlinedMenuButtonIsTheSameTarget() {
        compose.setContent { LedgerlineTheme(darkTheme = false) { ActionsButton("Actions for Sam", { log += "open" }, outlined = true) } }
        compose.onNode(hasContentDescription("Actions for Sam")).assertHeightIsAtLeast(48.dp).assertWidthIsAtLeast(48.dp).performClick()
        assertEquals(listOf("open"), log)
    }

    private val stateKey = SemanticsMatcher.keyIsDefined(SemanticsProperties.StateDescription)

    private fun state() = compose.onNode(stateKey).fetchSemanticsNode().config[SemanticsProperties.StateDescription]

    @Test
    fun aFoldRowTogglesAndSaysWhetherItIsOpen() {
        var open by androidx.compose.runtime.mutableStateOf(false)
        compose.setContent { LedgerlineTheme(darkTheme = false) { FoldRow("More options", open) { open = !open; log += "toggle" } } }
        assertEquals("Collapsed", state())
        compose.onNodeWithText("More options").performClick()
        assertEquals(listOf("toggle"), log)
        assertEquals("Expanded", state())
    }

    @Test
    fun aFoldRowIsAtLeastFiftySixDpTall() {
        compose.setContent { LedgerlineTheme(darkTheme = false) { FoldRow("More options", false) {} } }
        compose.onNode(stateKey).assertHeightIsAtLeast(56.dp)
    }

    @Test
    fun anOpenFoldRowSaysExpanded() {
        compose.setContent { LedgerlineTheme(darkTheme = false) { FoldRow("More options", true) {} } }
        assertEquals("Expanded", state())
    }

    @Test
    fun theSheetShowsItsContentAndAsksToCloseOnlyWhenDismissed() {
        compose.setContent { LedgerlineTheme(darkTheme = false) { LedgerSheet({ log += "dismiss" }) { Text("Inside the sheet") } } }
        compose.onNodeWithText("Inside the sheet").assertIsDisplayed()
        assertEquals(emptyList<String>(), log)
        // A tap on the dimmed screen outside it is a dismissal.
        compose.onNodeWithContentDescription("Close sheet").performClick()
        compose.waitForIdle()
        assertEquals(listOf("dismiss"), log)
    }
}
