package app.ledgerline.android.ui.home

import android.app.Application
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import app.ledgerline.android.overlay.AttentionItem
import app.ledgerline.android.overlay.AttentionReason
import app.ledgerline.android.ui.theme.LedgerlineTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** "Needs your attention" as plain data (WP-17): what each change says, what each button reports, and the question before Discard. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class AttentionContentTest {
    @get:Rule
    val compose = createComposeRule()

    private val log = mutableListOf<String>()

    private val actions = AttentionActions(
        onBack = { log += "back" },
        onFix = { log += "fix:$it" },
        onDiscard = { log += "discard:$it" },
        onKeepMine = { log += "mine:$it" },
        onKeepTheirs = { log += "theirs:$it" },
    )

    private val rejected = AttentionItem("r1", "transaction.create", "Grocer", -1250, "USD", AttentionReason.Rejected, "The category is archived.", canKeepMine = false)
    private val rejectedDelete = AttentionItem("r2", "transaction.delete", "Cafe", -400, "USD", AttentionReason.Rejected, "Not allowed.", canKeepMine = false)
    private val changed = AttentionItem("c1", "transaction.update", "Landlord", -90000, "USD", AttentionReason.ChangedElsewhere, null, canKeepMine = true)
    private val deleted = AttentionItem("d1", "transaction.update", "Gym", -3000, "USD", AttentionReason.DeletedElsewhere, null, canKeepMine = false)

    private fun show(vararg items: AttentionItem) = compose.setContent {
        LedgerlineTheme(darkTheme = false) { AttentionContent(items.toList(), actions) }
    }

    private fun inDialog(text: String) = hasText(text) and hasAnyAncestor(isDialog())

    @Test
    fun theTitleHasABackArrowThatGoesBack() {
        show(rejected)
        compose.onNodeWithText("Needs your attention").assertIsDisplayed()
        compose.onNodeWithContentDescription("Back").performClick()
        assertEquals(listOf("back"), log)
    }

    @Test
    fun nothingToDoSaysSoInTheSharedEmptyState() {
        show()
        compose.onNodeWithText("Nothing needs your attention.").assertIsDisplayed()
    }

    @Test
    fun eachChangeSaysWhatItWasAndWhyItNeedsYou() {
        show(rejected, changed)
        compose.onNodeWithText("Grocer", substring = true).assertIsDisplayed()
        compose.onNodeWithText("The server did not accept it: The category is archived.").assertIsDisplayed()
        compose.onNodeWithText("Changed on another device, so your change was not applied.").assertIsDisplayed()
    }

    @Test
    fun aRejectedChangeCanBeEditedAndADeleteCannot() {
        show(rejected, rejectedDelete)
        assertEquals(1, compose.onAllNodesWithTextCount("Edit"))
        compose.onNodeWithText("Edit").performClick()
        assertEquals(listOf("fix:r1"), log)
    }

    @Test
    fun aChangeThatLostOffersKeepMineOnlyWhenItCanAndKeepTheOtherAlways() {
        show(changed, deleted)
        assertEquals(1, compose.onAllNodesWithTextCount("Keep mine"))
        assertEquals(2, compose.onAllNodesWithTextCount("Keep the other"))
        compose.onNodeWithText("Keep mine").performClick()
        assertEquals(listOf("mine:c1"), log)
    }

    @Test
    fun keepTheOtherAsksNoQuestion() {
        show(changed)
        compose.onNodeWithText("Keep the other").performClick()
        assertEquals(listOf("theirs:c1"), log)
        assertEquals(0, compose.onAllNodesWithTextCount("Discard this change?"))
    }

    @Test
    fun discardAsksFirstAndDeletesNothingYet() {
        show(rejected)
        compose.onNodeWithText("Discard").performClick()
        compose.onNode(inDialog("Discard this change?")).assertIsDisplayed()
        compose.onNode(inDialog("It has not reached the server, so discarding it deletes it for good.")).assertIsDisplayed()
        assertEquals(emptyList<String>(), log)
    }

    @Test
    fun cancellingTheQuestionKeepsTheChange() {
        show(rejected)
        compose.onNodeWithText("Discard").performClick()
        compose.onNode(inDialog("Cancel")).performClick()
        assertEquals(emptyList<String>(), log)
        compose.onNodeWithText("Grocer", substring = true).assertIsDisplayed()
        assertEquals(0, compose.onAllNodesWithTextCount("Discard this change?"))
    }

    @Test
    fun confirmingDiscardsThatChangeOnly() {
        show(rejected, rejectedDelete)
        compose.onAllNodesWithTextAt("Discard", 1).performClick()
        compose.onNode(inDialog("Discard")).performClick()
        assertEquals(listOf("discard:r2"), log)
    }

    @Test
    fun everyButtonIsAtLeastFortyEightDpTall() {
        show(rejected, changed)
        listOf("Edit", "Discard", "Keep mine", "Keep the other").forEach { compose.onNodeWithText(it).assertHeightIsAtLeast(48.dp) }
    }

    private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.onAllNodesWithTextCount(text: String) =
        onAllNodes(hasText(text)).fetchSemanticsNodes().size

    private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.onAllNodesWithTextAt(text: String, index: Int) =
        onAllNodes(hasText(text))[index]
}
