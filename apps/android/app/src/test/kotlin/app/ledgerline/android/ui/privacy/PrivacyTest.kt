package app.ledgerline.android.ui.privacy

import android.app.Application
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import app.ledgerline.android.mirror.AccountBalance
import app.ledgerline.android.mirror.EntryLine
import app.ledgerline.android.overlay.AttentionItem
import app.ledgerline.android.overlay.AttentionReason
import app.ledgerline.android.ui.home.AccountRow
import app.ledgerline.android.ui.home.AttentionRow
import app.ledgerline.android.ui.home.EntryRow
import app.ledgerline.android.ui.home.MonthCard
import app.ledgerline.android.ui.home.homeSummary
import app.ledgerline.android.online.Online
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Privacy mode hides every amount, on screen and to a screen reader; FLAG_SECURE follows the switch. A plain
 * Application: these screens need no injection, and the app's own would start syncing when an activity opens.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class PrivacyTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun aMaskHasNoDigitsAndSaysTheAmountIsHidden() {
        val shown = shownMoney(123456, "USD", private = true, hidden = "Amount hidden")
        assertEquals(ShownMoney(AmountMask, "Amount hidden"), shown)
        assertFalse(shown.text.any(Char::isDigit))
        assertEquals("$1,234.56", shownMoney(123456, "USD", private = false, hidden = "Amount hidden").text)
    }

    @Test
    fun theWindowIsSecureUnlessScreenshotsAreAllowed() {
        val window = Robolectric.buildActivity(ComponentActivity::class.java).setup().get().window
        window.applyScreenshotRule(allowScreenshots = false)
        assertTrue(window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
        window.applyScreenshotRule(allowScreenshots = true)
        assertFalse(window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
    }

    @Test
    fun anAccountRowHidesItsBalance() = check { AccountRow(AccountBalance("a", "Checking", "bank", "USD", null, null, 123456, 0)) }

    @Test
    fun anEntryRowHidesItsAmount() = check {
        EntryRow(
            EntryLine("e", "2026-10-20", null, "expense", false, "cleared", -123456, "USD", "Grocer", "Checking", "Food", null, null, "2026-10-20T10:00:00Z"),
            unsent = false,
            onOpen = {},
        )
    }

    @Test
    fun aChangeThatNeedsTheOwnerHidesItsAmount() = check {
        AttentionRow(
            AttentionItem("c", "transaction.update", "Grocer", -123456, "USD", AttentionReason.ChangedElsewhere, null, canKeepMine = true),
            onFix = {},
            onDiscard = {},
            onKeepMine = {},
            onKeepTheirs = {},
        )
    }

    @Test
    fun theMonthOnHomeHidesEveryAmount() = check { MonthCard(Online.Ready(homeSummary(123456)), onRetry = {}) }

    /** With privacy off the amount is there (so the check can see it); with privacy on it is nowhere. */
    private fun check(row: @Composable () -> Unit) {
        var private by mutableStateOf(false)
        compose.setContent { CompositionLocalProvider(LocalPrivacy provides private) { row() } }
        assertTrue(words().any { "1,234.56" in it })
        private = true
        compose.waitForIdle()
        val hidden = words()
        assertFalse(hidden.toString(), hidden.any { "1,234" in it || "234.56" in it })
        assertTrue(hidden.toString(), hidden.any { "Amount hidden" in it })
    }

    /** Every text and description in the tree, as a screen reader or the screen would show them. */
    private fun words(): List<String> {
        val found = mutableListOf<String>()
        fun walk(node: SemanticsNode) {
            node.config.getOrNull(SemanticsProperties.Text)?.forEach { found += it.text }
            node.config.getOrNull(SemanticsProperties.ContentDescription)?.let { found += it }
            node.children.forEach(::walk)
        }
        walk(compose.onRoot(useUnmergedTree = true).fetchSemanticsNode())
        return found
    }
}
