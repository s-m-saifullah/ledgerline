package app.ledgerline.android.ui.home

import android.app.Application
import androidx.compose.foundation.layout.height
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.unit.dp
import app.ledgerline.android.mirror.EntryFilters
import app.ledgerline.android.mirror.EntryLine
import app.ledgerline.android.overlay.ShownLine
import app.ledgerline.android.ui.theme.LedgerlineTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalMaterial3Api::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class ScrollBackTest {
    @get:Rule
    val compose = createComposeRule()

    private val lines = List(12) {
        ShownLine(EntryLine("e$it", "2026-10-${10 + it}", null, "expense", false, "cleared", -1000L - it, "USD", "Payee $it", "Checking", "Food", null, null, "2026-10-${10 + it}T10:00:00Z"), false)
    }

    private fun swipeToEndAndBack(filters: EntryFilters) {
        compose.setContent {
            LedgerlineTheme {
                PullToRefreshBox(isRefreshing = false, onRefresh = {}, modifier = Modifier.height(640.dp)) {
                    TransactionsContent(
                        SyncStatus(SyncLine(null, false, null), 0, 0), Mirrored.Ready(lines), false, {}, filters, FilterOptions(), false, {}, {}, {}, {},
                        onOpen = {},
                    )
                }
            }
        }
        repeat(14) { compose.onNode(hasScrollToIndexAction()).performTouchInput { swipeUp() }; compose.waitForIdle() }
        repeat(14) { compose.onNode(hasScrollToIndexAction()).performTouchInput { swipeDown() }; compose.waitForIdle() }
        compose.onNodeWithText("Transactions").assertExists()
    }

    @Test
    fun scrollingBackUpWorksWithoutFilters() = swipeToEndAndBack(EntryFilters())

    @Test
    fun scrollingBackUpWorksWithAFilterSet() = swipeToEndAndBack(EntryFilters(status = "cleared"))
}
