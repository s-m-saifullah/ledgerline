package app.ledgerline.android.ui.design

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.v2.createComposeRule
import app.ledgerline.android.online.AutoLoadCap
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.Paged
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The screen asks for the next page by itself, until there is none, a page fails, or the cap is reached. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class AutoLoadMoreTest {
    @get:Rule
    val compose = createComposeRule()

    private var asked = 0
    private var state by mutableStateOf<Online<Paged<Int>>>(Online.Loading)

    private fun show() = compose.setContent { AutoLoadMore(state) { asked++ } }

    private fun rows(n: Int, hasMore: Boolean = true, loadingMore: Boolean = false, moreFailed: Boolean = false) =
        Online.Ready(Paged(List(n) { it }, hasMore = hasMore, loadingMore = loadingMore, moreFailed = moreFailed))

    @Test
    fun asksForTheNextPageWhenThereIsOne() {
        show()
        state = rows(50)
        compose.waitForIdle()
        assertEquals(1, asked)
    }

    @Test
    fun asksAgainWhenThePageArrivesAndThereIsStillMore() {
        show()
        state = rows(50)
        compose.waitForIdle()
        state = rows(100)
        compose.waitForIdle()
        assertEquals(2, asked)
    }

    @Test
    fun stopsWhenThereIsNoMore() {
        show()
        state = rows(50, hasMore = false)
        compose.waitForIdle()
        assertEquals(0, asked)
    }

    @Test
    fun doesNotAskWhileAPageIsOnItsWay() {
        show()
        state = rows(50, loadingMore = true)
        compose.waitForIdle()
        assertEquals(0, asked)
    }

    @Test
    fun doesNotAskAfterAPageFailed() {
        show()
        state = rows(50, moreFailed = true)
        compose.waitForIdle()
        assertEquals(0, asked)
    }

    @Test
    fun stopsAtTheCapAndLeavesTheRestToTheButton() {
        show()
        state = rows(AutoLoadCap)
        compose.waitForIdle()
        assertEquals(0, asked)
    }

    @Test
    fun asksJustBelowTheCap() {
        show()
        state = rows(AutoLoadCap - 1)
        compose.waitForIdle()
        assertEquals(1, asked)
    }

    @Test
    fun asksForNothingWhileLoadingOrWhenItFailed() {
        show()
        state = Online.Loading
        compose.waitForIdle()
        state = Online.Offline
        compose.waitForIdle()
        state = Online.Failed
        compose.waitForIdle()
        assertEquals(0, asked)
    }
}
