package app.ledgerline.android.ui.design

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.v2.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** What a screen is told when it goes away for good (Back, a tab change, another screen). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LeavingTest {
    @get:Rule
    val compose = createComposeRule()

    private var showing by mutableStateOf(true)
    private var step by mutableStateOf(1)
    private var left = 0

    private fun show() = compose.setContent {
        // Read while composing, so the callback below holds this value: a stale callback would add the first one.
        val now = step
        if (showing) OnLeaving { left += now }
    }

    @Test
    fun goingToAnotherScreenLeavesIt() {
        show()
        compose.runOnIdle { showing = false }
        compose.waitForIdle()
        assertEquals(1, left)
    }

    @Test
    fun aScreenStillShownHasNotLeft() {
        show()
        compose.waitForIdle()
        assertEquals(0, left)
    }

    @Test
    fun theLeaveCallbackIsTheLatestOneNotTheFirst() {
        show()
        compose.runOnIdle { step = 7 }
        compose.waitForIdle()
        compose.runOnIdle { showing = false }
        compose.waitForIdle()
        assertEquals(7, left)
    }
}
