package app.ledgerline.android.ui.settings

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import app.ledgerline.android.settings.FilterKeep
import app.ledgerline.android.settings.KeepMode
import app.ledgerline.android.settings.KeepUnit
import app.ledgerline.android.settings.ThemeChoice
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Settings, as plain data: the theme choice, the switches and what each one does. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class SettingsContentTest {
    @get:Rule
    val compose = createComposeRule()

    private val state = SettingsState(
        theme = ThemeChoice.System,
        hideAmounts = false,
        centsFirst = true,
        allowScreenshots = false,
        filterKeep = FilterKeep(),
        unsent = 0,
        attention = 0,
        canLock = true,
        signingOut = false,
    )

    private class Taps {
        val themes = mutableListOf<ThemeChoice>()
        val cents = mutableListOf<Boolean>()
        val hide = mutableListOf<Boolean>()
        val keeps = mutableListOf<FilterKeep>()
        var back = 0

        fun actions() = SettingsActions(
            onBack = { back++ },
            setTheme = { themes += it },
            setHideAmounts = { hide += it },
            setCentsFirst = { cents += it },
            setAllowScreenshots = {},
            setFilterKeep = { keeps += it },
            openAttention = {},
            refreshEverything = {},
            lock = {},
            signOut = {},
        )
    }

    @Test
    fun theThemeChoiceShowsTheSelectedOptionAndPicksAnother() {
        val taps = Taps()
        compose.setContent { SettingsContent(state, taps.actions(), 0.dp, Modifier.requiredHeight(3000.dp)) }
        compose.onNodeWithText("System").assertIsSelected()
        compose.onNodeWithText("Light").assertIsNotSelected()
        compose.onNodeWithText("Dark").assertIsNotSelected()
        compose.onNodeWithText("Dark").performClick()
        compose.onNodeWithText("Light").performClick()
        assertEquals(listOf(ThemeChoice.Dark, ThemeChoice.Light), taps.themes)
    }

    @Test
    fun theSwitchesShowTheirStateAndFlipIt() {
        val taps = Taps()
        compose.setContent { SettingsContent(state, taps.actions(), 0.dp, Modifier.requiredHeight(3000.dp)) }
        compose.onNodeWithText("Type amounts from the cents").assertIsOn()
        compose.onNodeWithText("Type amounts from the cents").performClick()
        compose.onNodeWithText("Hide amounts").performClick()
        assertEquals(listOf(false), taps.cents)
        assertEquals(listOf(true), taps.hide)
    }

    @Test
    fun theBackLinkReturnsToMore() {
        val taps = Taps()
        compose.setContent { SettingsContent(state, taps.actions(), 0.dp, Modifier.requiredHeight(3000.dp)) }
        compose.onNodeWithText("←  More").performClick()
        assertEquals(1, taps.back)
    }

    private fun showKeeping(keep: FilterKeep, taps: Taps) {
        compose.setContent { SettingsContent(state.copy(filterKeep = keep), taps.actions(), 0.dp, Modifier.requiredHeight(3000.dp)) }
    }

    @Test
    fun theKeepChoiceShowsTheCurrentModeAndPicksAnotherKeepingTheTime() {
        val taps = Taps()
        showKeeping(FilterKeep(KeepMode.UntilAppCloses, 30, KeepUnit.Minutes), taps)
        compose.onNodeWithText("Until I close the app").assertIsSelected()
        compose.onNodeWithText("Until I leave Transactions").assertIsNotSelected()
        compose.onNodeWithText("Until I leave Transactions").performClick()
        compose.onNodeWithText("For a time I choose").performClick()
        assertEquals(
            listOf(
                FilterKeep(KeepMode.UntilLeave, 30, KeepUnit.Minutes),
                FilterKeep(KeepMode.ForAWhile, 30, KeepUnit.Minutes),
            ),
            taps.keeps,
        )
    }

    @Test
    fun goingBackToUntilICloseTheAppRemembersTheTimeTyped() {
        val taps = Taps()
        showKeeping(FilterKeep(KeepMode.ForAWhile, 15, KeepUnit.Days), taps)
        compose.onNodeWithText("Until I close the app").performClick()
        assertEquals(listOf(FilterKeep(KeepMode.UntilAppCloses, 15, KeepUnit.Days)), taps.keeps)
    }

    @Test
    fun theNumberAndUnitBoxesShowOnlyForATime() {
        showKeeping(FilterKeep(KeepMode.UntilLeave), Taps())
        compose.onNodeWithText("Number").assertDoesNotExist()
        compose.onNodeWithText("Unit").assertDoesNotExist()
    }

    @Test
    fun aValidNumberIsSavedAndAnInvalidOneIsExplainedAndNotSaved() {
        val taps = Taps()
        showKeeping(FilterKeep(KeepMode.ForAWhile, 1, KeepUnit.Hours), taps)
        compose.onNodeWithText("Number").assertExists()
        compose.onNode(hasText("1") and hasSetTextAction()).performTextReplacement("45")
        assertEquals(listOf(FilterKeep(KeepMode.ForAWhile, 45, KeepUnit.Hours)), taps.keeps)
        compose.onNode(hasSetTextAction()).performTextReplacement("0")
        compose.onNodeWithText("Enter a whole number from 1 to 999.").assertExists()
        assertEquals(1, taps.keeps.size)
        compose.onNode(hasSetTextAction()).performTextReplacement("")
        compose.onNodeWithText("Enter a whole number from 1 to 999.").assertExists()
        assertEquals(1, taps.keeps.size)
    }

    @Test
    fun theUnitIsChosenFromMinutesHoursAndDays() {
        val taps = Taps()
        showKeeping(FilterKeep(KeepMode.ForAWhile, 2, KeepUnit.Hours), taps)
        compose.onNodeWithContentDescription("Unit").performClick()
        compose.onNodeWithText("Days").performClick()
        assertEquals(listOf(FilterKeep(KeepMode.ForAWhile, 2, KeepUnit.Days)), taps.keeps)
    }

    @Test
    fun theUnitIsSingularForOneAndPluralOtherwise() {
        showKeeping(FilterKeep(KeepMode.ForAWhile, 1, KeepUnit.Hours), Taps())
        compose.onNodeWithText("Hour").assertExists()
        compose.onNodeWithText("Hours").assertDoesNotExist()
        compose.onNodeWithContentDescription("Unit").performClick()
        // The list follows the number too.
        compose.onNodeWithText("Minute").assertExists()
        compose.onNodeWithText("Day").assertExists()
        compose.onNodeWithText("Minutes").assertDoesNotExist()
    }

    @Test
    fun typingANumberChangesTheUnitBetweenSingularAndPlural() {
        showKeeping(FilterKeep(KeepMode.ForAWhile, 2, KeepUnit.Days), Taps())
        compose.onNodeWithText("Days").assertExists()
        compose.onNode(hasSetTextAction()).performTextReplacement("1")
        compose.onNodeWithText("Day").assertExists()
        compose.onNodeWithText("Days").assertDoesNotExist()
        compose.onNode(hasSetTextAction()).performTextReplacement("10")
        compose.onNodeWithText("Days").assertExists()
        // Zero and an empty box are not a number: the unit stays plural.
        compose.onNode(hasSetTextAction()).performTextReplacement("")
        compose.onNodeWithText("Days").assertExists()
    }
}
