package app.ledgerline.android.ui.design

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config

/** What a screen is told when it goes away, in an activity that is recreated (rotation, dark mode, font size) and one that is left. */
class LeavingActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            // Read while composing, so the callback below holds this value: a stale callback would add the first one.
            val now = step
            if (showing) OnLeaving { left += now }
        }
    }

    companion object {
        var showing by mutableStateOf(true)
        var left = 0
        var step by mutableStateOf(1)
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LeavingTest {
    private var controller: ActivityController<LeavingActivity>? = null

    /** Each test's activity is destroyed at its end: the state is shared, and a screen left composed would count in the next test. */
    @After
    fun destroy() {
        controller?.destroy()
        shadowOf(android.os.Looper.getMainLooper()).idle()
    }

    private fun start(): ActivityController<LeavingActivity> {
        LeavingActivity.showing = true
        LeavingActivity.left = 0
        LeavingActivity.step = 1
        return Robolectric.buildActivity(LeavingActivity::class.java).setup().also {
            controller = it
            shadowOf(android.os.Looper.getMainLooper()).idle()
        }
    }

    @Test
    fun aRecreatedActivityDoesNotLeaveTheScreen() {
        val controller = start()
        controller.recreate()
        shadowOf(android.os.Looper.getMainLooper()).idle()
        assertEquals("rotation is not leaving", 0, LeavingActivity.left)
    }

    @Test
    fun goingToAnotherScreenLeavesIt() {
        start()
        LeavingActivity.showing = false
        shadowOf(android.os.Looper.getMainLooper()).idle()
        assertEquals(1, LeavingActivity.left)
    }

    @Test
    fun theLeaveCallbackIsTheLatestOneNotTheFirst() {
        start()
        LeavingActivity.step = 7
        shadowOf(android.os.Looper.getMainLooper()).idle()
        LeavingActivity.showing = false
        shadowOf(android.os.Looper.getMainLooper()).idle()
        assertEquals(7, LeavingActivity.left)
    }
}
