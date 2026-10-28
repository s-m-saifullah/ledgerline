package app.ledgerline.android.ui.design

import android.app.Application
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import app.ledgerline.android.ui.theme.DarkPalette
import app.ledgerline.android.ui.theme.LedgerlineTheme
import app.ledgerline.android.ui.theme.LightPalette
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The redesign's building blocks (ADR 0046): their pure rules and their touch-target sizes. A plain Application, as the other Compose tests. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class PiecesTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun initialsAreTheFirstLettersOfTheFirstTwoWords() {
        assertEquals("VV", initialsOf("Vapor Vault"))
        assertEquals("CC", initialsOf("Chime Credit Builder"))
        assertEquals("CH", initialsOf("Chase"))
        assertEquals("S6", initialsOf("Studio 6"))
        assertEquals("A", initialsOf("a"))
        assertEquals("?", initialsOf("   "))
        assertEquals("?", initialsOf("🙂"))
    }

    @Test
    fun aLimitIsNearAtNinetyPerCentAndOverAboveIt() {
        assertEquals(LimitState.Within, limitState(used = 89, limit = 100))
        assertEquals(LimitState.Near, limitState(used = 90, limit = 100))
        assertEquals(LimitState.Near, limitState(used = 100, limit = 100))
        assertEquals(LimitState.Over, limitState(used = 101, limit = 100))
        assertEquals(LimitState.Within, limitState(used = 500, limit = 0))
    }

    @Test
    fun theRampHasFiveTintsAndThenTheNeutral() {
        val tints = (0..4).map { chartColor(LightPalette, it) }
        assertEquals(5, tints.toSet().size)
        assertEquals(LightPalette.fieldBorder, chartColor(LightPalette, 5))
        assertEquals(LightPalette.fieldBorder, chartColor(LightPalette, 40))
        assertNotEquals(chartColor(LightPalette, 0), chartColor(DarkPalette, 0))
    }

    @Test
    fun aSegmentedControlSelectsOneAndEachSegmentIsATouchTarget() {
        var selected by mutableIntStateOf(0)
        compose.setContent {
            LedgerlineTheme { SegmentedControl(listOf("Expense", "Income"), selected, { selected = it }) }
        }
        compose.onNodeWithText("Expense").assertIsSelected().assertHeightIsAtLeast(TouchTarget)
        compose.onNodeWithText("Income").assertIsNotSelected().performClick()
        compose.waitForIdle()
        assertEquals(1, selected)
        compose.onNodeWithText("Income").assertIsSelected()
        compose.onNodeWithText("Expense").assertIsNotSelected()
    }

    @Test
    fun threeOrMoreOptionsStackAtLargeTextAndTwoNeverDo() {
        assertTrue(segmentsStacked(2f, listOf("a", "b", "c")))
        assertTrue(segmentsStacked(1.4f, listOf("a", "b", "c", "d")))
        assertEquals(false, segmentsStacked(2f, listOf("a", "b")))
        assertEquals(false, segmentsStacked(1.3f, listOf("a", "b", "c")))
        assertEquals(false, segmentsStacked(1f, listOf("a", "b", "c", "d")))
    }

    private fun segmentTops(fontScale: Float): List<Pair<Float, Float>> {
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(2f, fontScale)) {
                LedgerlineTheme { SegmentedControl(listOf("Expense", "Income", "Transfer"), 0, {}) }
            }
        }
        return listOf("Expense", "Income", "Transfer").map {
            val box = compose.onNodeWithText(it).getUnclippedBoundsInRoot()
            box.left.value to box.top.value
        }
    }

    @Test
    fun threeSegmentsSitSideBySideAtNormalTextSize() {
        val (a, b, c) = segmentTops(1f)
        assertEquals(a.second, b.second, 0.5f)
        assertEquals(b.second, c.second, 0.5f)
    }

    @Test
    fun threeSegmentsStackOneUnderTheOtherAtTheLargestTextSize() {
        val (a, b, c) = segmentTops(2f)
        assertTrue(a.second < b.second && b.second < c.second)
        assertEquals(a.first, b.first, 0.5f)
    }

    @Test
    fun aFilterChipIsAFortyEightDpTargetAndToggles() {
        var on by mutableStateOf(false)
        compose.setContent { LedgerlineTheme { FilterChip("Income", on) { on = !on } } }
        compose.onNodeWithText("Income").assertIsNotSelected().assertHeightIsAtLeast(TouchTarget)
        compose.onNodeWithText("Income").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Income").assertIsSelected()
    }

    @Test
    fun aListRowIsAtLeastFiftySixDpAndTheBackArrowIsATouchTarget() {
        var back = 0
        compose.setContent {
            LedgerlineTheme {
                Column {
                    TopBar("Clients", onBack = { back++ })
                    GroupedListCard { row { ListRow("Studio 6", onClick = {}) } }
                }
            }
        }
        compose.onNodeWithText("Studio 6").assertHeightIsAtLeast(RowHeight)
        compose.onNodeWithContentDescription("Back").assertHeightIsAtLeast(TouchTarget).performClick()
        assertEquals(1, back)
    }

    @Test
    fun anAmountStaysBesideTheNameOnlyWhileTheNameKeepsItsLongestWordAndTheMinimum() {
        assertTrue(amountFitsBeside(roomForTitle = 120, longestWord = 60, minTitle = 80))
        assertTrue(amountFitsBeside(roomForTitle = 80, longestWord = 60, minTitle = 80))
        assertTrue(!amountFitsBeside(roomForTitle = 79, longestWord = 60, minTitle = 80))
        assertTrue(!amountFitsBeside(roomForTitle = 100, longestWord = 101, minTitle = 80))
        assertTrue(amountFitsBeside(roomForTitle = 0, longestWord = 0, minTitle = 0))
    }
}
