package app.ledgerline.android.ui.editor

import android.app.Application
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** What a picker sheet holds: the choices, a search box only when there are many, the chosen one marked, New category. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class PickerContentTest {
    @get:Rule
    val compose = createComposeRule()

    private val few = listOf(Choice("a", "Checking", "USD"), Choice("b", "Cash", "USD"))
    private val many = (1..PickerSearchFrom).map { Choice("c$it", if (it == 3) "Gas" else "Category $it", "USD") }

    private val log = mutableListOf<String>()

    private fun show(choices: List<Choice>, selected: String? = null, onNew: (() -> Unit)? = null, modifier: Modifier = Modifier) = compose.setContent {
        PickerContent("Account", choices, selected, { log += "pick:$it" }, { log += "cancel" }, modifier, onNew)
    }

    @Test
    fun fewChoicesHaveNoSearchBoxAndEightHaveOne() {
        show(few)
        compose.onNode(hasSetTextAction()).assertDoesNotExist()
    }

    @Test
    fun theSearchBoxComesAtEightChoices() {
        show(many)
        compose.onNode(hasSetTextAction()).assertExists()
    }

    @Test
    fun typingNarrowsTheListIgnoringCaseAndNothingMatchingSaysSo() {
        show(many)
        compose.onNode(hasSetTextAction()).performTextReplacement("gAs")
        compose.onNodeWithText("Gas").assertExists()
        compose.onNodeWithText("Category 1").assertDoesNotExist()
        compose.onNode(hasSetTextAction()).performTextReplacement("zzz")
        compose.onNodeWithText("Nothing matches.").assertExists()
    }

    @Test
    fun choosingAndCancellingReport() {
        show(few)
        compose.onNodeWithText("Cash").performClick()
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(listOf("pick:b", "cancel"), log)
    }

    @Test
    fun theChosenOneIsMarkedWithACheckAndTheOthersAreNot() {
        show(few, selected = "a")
        compose.onNodeWithText("Checking").assertIsSelected()
        compose.onNodeWithText("Cash").assertIsNotSelected()
        compose.onAllNodesWithContentDescription("Chosen").assertCountEquals(1)
    }

    @Test
    fun currenciesAreNotSaidWhenEveryChoiceHasTheSameOne() {
        show(few)
        compose.onNodeWithText("USD").assertDoesNotExist()
    }

    @Test
    fun currenciesAreSaidWhenTheChoicesMixThem() {
        show(listOf(Choice("a", "Checking", "USD"), Choice("b", "Yen", "JPY")))
        compose.onNodeWithText("USD").assertExists()
        compose.onNodeWithText("JPY").assertExists()
    }

    @Test
    fun anArchivedChoiceSaysSo() {
        show(listOf(Choice("a", "Old", archived = true), Choice("b", "New")), selected = "a")
        compose.onNodeWithText("Old (archived)").assertExists()
    }

    @Test
    fun newCategoryIsTheLastRowAndOnlyWhenAsked() {
        show(few)
        compose.onNodeWithText("New category").assertDoesNotExist()
    }

    @Test
    fun newCategoryReportsItsTap() {
        var asked = 0
        show(few, onNew = { asked++ })
        compose.onNodeWithText("New category").performClick()
        assertEquals(1, asked)
    }

    @Test
    fun newCategoryStaysInReachWhileTheListIsFilteredToNothing() {
        var asked = 0
        show(many, onNew = { asked++ })
        compose.onNode(hasSetTextAction()).performTextReplacement("zzz")
        compose.onNodeWithText("Nothing matches.").assertExists()
        compose.onNodeWithText("New category").performClick()
        assertEquals(1, asked)
    }

    @Test
    fun theSearchBoxStaysWhereItIsWhenTheListGetsShorter() {
        var list by mutableStateOf(many)
        compose.setContent { PickerContent("Account", list, null, {}, {}, Modifier.height(400.dp)) }
        val before = compose.onNode(hasSetTextAction()).getUnclippedBoundsInRoot().top
        compose.onNode(hasSetTextAction()).performTextReplacement("Category 1")
        compose.waitForIdle()
        assertEquals(before, compose.onNode(hasSetTextAction()).getUnclippedBoundsInRoot().top)
    }

    /** The sheet sits at the bottom of the screen and sizes itself, as the real one does: its own height must not follow the list. */
    private fun topOfSheetAfterTyping(choices: List<Choice>, typed: String): Pair<Float, Float> {
        compose.setContent {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
                PickerContent("Account", choices, null, {}, {})
            }
        }
        val before = compose.onNodeWithText("Account").getUnclippedBoundsInRoot().top.value
        compose.onNode(hasSetTextAction()).performTextReplacement(typed)
        compose.waitForIdle()
        return before to compose.onNodeWithText("Account").getUnclippedBoundsInRoot().top.value
    }

    private val twelve = (1..12).map { Choice("c$it", "Category $it") }

    private fun assertSheetStays(typed: String) {
        val (before, after) = topOfSheetAfterTyping(twelve, typed)
        assertEquals("typed '$typed'", before, after, 0.5f)
    }

    @Test
    fun theSheetKeepsItsHeightWhenTheListShrinksToAFew() = assertSheetStays("Category 1")

    @Test
    fun theSheetKeepsItsHeightWhenNothingMatches() = assertSheetStays("zzz")

    @Test
    fun theSheetKeepsItsHeightWhenOneMatches() = assertSheetStays("Category 12")

    @Test
    fun newCategoryIsOnScreenUnderALongListInASheetOfFixedHeight() {
        compose.setContent {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
                PickerContent("Category", twelve, null, {}, {}, onNew = {})
            }
        }
        compose.onNodeWithText("New category").assertIsDisplayed()
        compose.onNodeWithText("Cancel").assertIsDisplayed()
    }

    @Test
    fun pickerChoicesAreFilteredByLabelAndAnEmptyQueryKeepsAll() {
        assertEquals(many, pickerChoices(many, "  "))
        assertEquals(listOf("Gas"), pickerChoices(many, "GAS").map { it.label })
    }
}
