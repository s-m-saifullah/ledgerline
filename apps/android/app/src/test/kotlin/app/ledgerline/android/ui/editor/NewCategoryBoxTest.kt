package app.ledgerline.android.ui.editor

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import app.ledgerline.android.ui.categories.CategoryError
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The "New category" name box as plain data: open, invalid, failed and busy. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class NewCategoryBoxTest {
    @get:Rule
    val compose = createComposeRule()

    private val log = mutableListOf<String>()

    private fun show(box: NewCategory) = compose.setContent {
        NewCategoryFields(box, onName = { log += "name:$it" }, onCreate = { log += "create" })
    }

    @Test
    fun openItAsksForANameAndTheAddButtonStartsOff() {
        show(NewCategory())
        compose.onNodeWithText("New category name").assertExists()
        compose.onNodeWithText("Add category").assertIsNotEnabled()
        compose.onNodeWithText("Give the category a name of 1–100 characters.").assertDoesNotExist()
    }

    @Test
    fun typingReportsTheNameAndAValidNameEnablesAdd() {
        show(NewCategory("Pets"))
        compose.onNodeWithText("Add category").assertIsEnabled().performClick()
        compose.onNode(hasSetTextAction()).performTextReplacement("Pets and vets")
        assertEquals(listOf("create", "name:Pets and vets"), log)
    }

    @Test
    fun aNameTooLongIsExplainedAndCannotBeAdded() {
        show(NewCategory("x".repeat(101)))
        compose.onNodeWithText("Give the category a name of 1–100 characters.").assertExists()
        compose.onNodeWithText("Add category").assertIsNotEnabled()
    }

    @Test
    fun whileCreatingTheBoxSaysSoAndCannotBeChanged() {
        show(NewCategory("Pets", creating = true))
        compose.onNodeWithText("Adding…").assertIsNotEnabled()
    }

    @Test
    fun everyErrorIsWordedAndTheServersSentenceIsShownAsItIs() {
        var shown by mutableStateOf<CategoryError?>(CategoryError.Offline)
        compose.setContent { NewCategoryFields(NewCategory("Food", error = shown), {}, {}) }
        val cases = listOf(
            CategoryError.Offline to "needs a connection",
            CategoryError.Forbidden to "can't change categories",
            CategoryError.Failed to "Couldn't save the category",
            CategoryError.Rejected("A sibling category already has this name.") to "A sibling category already has this name.",
            CategoryError.Rejected(null) to "didn't accept this change",
        )
        for ((error, text) in cases) {
            compose.runOnIdle { shown = error }
            compose.onNodeWithText(text, substring = true).assertExists()
        }
    }
}
