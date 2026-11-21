package app.ledgerline.android.ui.design

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.DisposableEffect
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config

/** A screen in an activity that is recreated (rotation, dark mode, font size) is disposed, but the person has not left it. */
class RecreatedActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            OnLeaving { left += 1 }
            DisposableEffect(Unit) { onDispose { disposed += 1 } }
        }
    }

    companion object {
        var left = 0
        var disposed = 0
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LeavingRecreationTest {
    private var controller: ActivityController<RecreatedActivity>? = null

    @After
    fun destroy() {
        controller?.destroy()
        shadowOf(android.os.Looper.getMainLooper()).idle()
    }

    @Test
    fun aRecreatedActivityDisposesTheScreenButDoesNotLeaveIt() {
        RecreatedActivity.left = 0
        RecreatedActivity.disposed = 0
        val started = Robolectric.buildActivity(RecreatedActivity::class.java).setup()
        controller = started
        shadowOf(android.os.Looper.getMainLooper()).idle()
        started.recreate()
        shadowOf(android.os.Looper.getMainLooper()).idle()
        // The old screen really was disposed (so the check below is not passing on a composition that never ran)...
        assertEquals("the old composition was disposed", 1, RecreatedActivity.disposed)
        // ...and rotation is not leaving.
        assertEquals("rotation is not leaving", 0, RecreatedActivity.left)
    }
}
