package app.ledgerline.android.ui.design

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The search field's cross: shown only while there is text, and it empties the field. A plain Application, as the other Compose tests. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class SearchFieldTest {
    @get:Rule
    val compose = createComposeRule()

    private var text by mutableStateOf("")

    private fun show() = compose.setContent { SearchField("Search clients", text) { text = it } }

    @Test
    fun theCrossIsHiddenWhileTheFieldIsEmpty() {
        show()
        compose.onNodeWithContentDescription("Clear search").assertDoesNotExist()
    }

    @Test
    fun theCrossAppearsWithTextAndEmptiesTheField() {
        text = "north"
        show()
        compose.onNodeWithContentDescription("Clear search").assertIsDisplayed().performClick()
        compose.waitForIdle()
        assertEquals("", text)
        compose.onNodeWithContentDescription("Clear search").assertDoesNotExist()
    }
}
