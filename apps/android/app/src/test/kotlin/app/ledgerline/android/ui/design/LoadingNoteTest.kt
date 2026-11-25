package app.ledgerline.android.ui.design

import android.app.Application
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** A read in progress is a line inside a card (inset by the screen margin and the card's padding), not bare text on the page. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class LoadingNoteTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun theTextSitsInsideACard() {
        compose.setContent { Box(Modifier.width(360.dp)) { LoadingNote("Loading your budgets…") } }
        val left = compose.onNodeWithText("Loading your budgets…").getBoundsInRoot().left
        assertTrue("the text starts at $left, not inside a card", left >= ScreenMargin + 16.dp)
    }
}
