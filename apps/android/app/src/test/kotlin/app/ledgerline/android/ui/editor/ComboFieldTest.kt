package app.ledgerline.android.ui.editor

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextInput
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The searchable category and tag boxes: open, type to narrow, pick; no "No category" choice anywhere. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class ComboFieldTest {
    @get:Rule
    val compose = createComposeRule()

    private val categories = listOf(
        Choice("a", "Food"),
        Choice("a1", "Food › Groceries"),
        Choice("a2", "Food › Restaurants"),
        Choice("b", "Bills"),
    )

    private var picked by mutableStateOf<String?>(null)

    private fun show(selected: String? = null, choices: List<Choice> = categories) {
        picked = selected
        compose.setContent {
            ComboField(
                label = "Category",
                choices = choices,
                selected = picked,
                onSelect = { picked = it },
                emptyText = "No matching categories.",
                placeholder = "Choose a category",
            )
        }
    }

    private val box get() = compose.onNode(hasSetTextAction())

    @Test
    fun tappingOpensEveryChoiceAndThereIsNoNoneChoice() {
        show()
        box.performClick()
        categories.forEach { compose.onNodeWithText(it.label).assertExists() }
        compose.onNodeWithText("No category").assertDoesNotExist()
    }

    @Test
    fun typingNarrowsTheListAndAChoicePicksIt() {
        show()
        box.performClick()
        box.performTextInput("gro")
        compose.onNodeWithText("Food › Groceries").assertExists()
        compose.onNodeWithText("Bills").assertDoesNotExist()
        compose.onNodeWithText("Food › Restaurants").assertDoesNotExist()
        compose.onNodeWithText("Food › Groceries").performClick()
        assertEquals("a1", picked)
        compose.waitForIdle()
        box.assertTextContains("Food › Groceries")
    }

    @Test
    fun noMatchShowsAMessageThatCannotBePicked() {
        show()
        box.performClick()
        box.performTextInput("zzz")
        compose.onNodeWithText("No matching categories.").assertExists()
        compose.onNodeWithText("No matching categories.").assertIsNotEnabled()
        assertEquals(null, picked)
    }

    @Test
    fun theKeyboardsDonePicksTheFirstMatch() {
        show()
        box.performClick()
        box.performTextInput("food")
        box.performImeAction()
        assertEquals("a", picked)
    }

    @Test
    fun theCurrentChoiceShowsWhenClosed() {
        show(selected = "b")
        box.assertTextContains("Bills")
    }

    @Test
    fun anArchivedCurrentChoiceIsMarked() {
        show(selected = "x", choices = categories + Choice("x", "Old", archived = true))
        box.assertTextContains("Old (archived)")
    }

    @Test
    fun theBoxEmptiesAfterAPickWhenAskedTo() {
        var last: String? = null
        compose.setContent {
            ComboField("Tags", categories, null, { last = it }, "No matching tags.", clearAfterPick = true)
        }
        box.performClick()
        compose.onNodeWithText("Bills").performClick()
        assertEquals("b", last)
        compose.waitForIdle()
        box.assertTextContains("")
        compose.onNodeWithText("Bills").assertDoesNotExist()
    }

    @Test
    fun aDisabledBoxCannotBeUsed() {
        compose.setContent { ComboField("Tags", categories, null, {}, "none", enabled = false) }
        compose.onNodeWithText("Tags").assertIsNotEnabled()
    }
}
