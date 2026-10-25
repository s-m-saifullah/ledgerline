package app.ledgerline.android.ui.settings

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsOff
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
import androidx.compose.ui.test.assertIsNotEnabled
import app.ledgerline.android.ui.home.SyncLine
import app.ledgerline.android.ui.home.SyncProblem
import app.ledgerline.android.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
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
        updates = UpdatesInfo(auto = true, newVersion = null),
        unsent = 0,
        attention = 0,
        canLock = true,
        signingOut = false,
        pill = SyncPill.Synced,
    )

    private class Taps {
        val themes = mutableListOf<ThemeChoice>()
        val cents = mutableListOf<Boolean>()
        val hide = mutableListOf<Boolean>()
        val keeps = mutableListOf<FilterKeep>()
        val auto = mutableListOf<Boolean>()
        var updatesOpened = 0
        var locked = 0
        var signedOut = 0
        var refreshed = 0
        var attentionOpened = 0
        var back = 0

        fun actions() = SettingsActions(
            onBack = { back++ },
            setTheme = { themes += it },
            setHideAmounts = { hide += it },
            setCentsFirst = { cents += it },
            setAllowScreenshots = {},
            setFilterKeep = { keeps += it },
            setAutoUpdate = { auto += it },
            openUpdates = { updatesOpened++ },
            openAttention = { attentionOpened++ },
            refreshEverything = { refreshed++ },
            lock = { locked++ },
            signOut = { signedOut++ },
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
    fun theUpdatesCardHasTheAutomaticSwitchAndTheCheckButton() {
        val taps = Taps()
        compose.setContent { SettingsContent(state, taps.actions(), 0.dp, Modifier.requiredHeight(3000.dp)) }
        compose.onNodeWithText("Check for updates automatically").assertIsOn()
        compose.onNodeWithText("Check for updates automatically").performClick()
        assertEquals(listOf(false), taps.auto)
        compose.onNodeWithText("Check for updates", useUnmergedTree = true).performClick()
        assertEquals(1, taps.updatesOpened)
    }

    @Test
    fun theUpdatesCardNamesANewerVersionAndTheSwitchShowsOff() {
        val taps = Taps()
        compose.setContent { SettingsContent(state.copy(updates = UpdatesInfo(auto = false, newVersion = "0.1.3")), taps.actions(), 0.dp, Modifier.requiredHeight(3000.dp)) }
        compose.onNodeWithText("Version 0.1.3 is available").assertExists()
        compose.onNodeWithText("Check for updates automatically").assertIsOff()
    }

    @Test
    fun aBuildThatCannotCheckHasNoUpdatesCard() {
        val taps = Taps()
        compose.setContent { SettingsContent(state.copy(updates = null), taps.actions(), 0.dp, Modifier.requiredHeight(3000.dp)) }
        compose.onNodeWithText("Check for updates automatically").assertDoesNotExist()
    }

    @Test
    fun theBackArrowInTheTopBarReturnsToMore() {
        val taps = Taps()
        compose.setContent { SettingsContent(state, taps.actions(), 0.dp, Modifier.requiredHeight(3000.dp)) }
        compose.onNodeWithText("Settings").assertExists()
        compose.onNodeWithContentDescription("Back").performClick()
        assertEquals(1, taps.back)
    }

    @Test
    fun theOldHeaderAndTheRepeatedThisPhoneAreGone() {
        compose.setContent { SettingsContent(state, Taps().actions(), 0.dp, Modifier.requiredHeight(3000.dp)) }
        compose.onNodeWithText("This phone").assertDoesNotExist()
        compose.onNodeWithText("Make it yours").assertDoesNotExist()
        compose.onNodeWithText("The little details that make your ledger feel like home.").assertDoesNotExist()
        compose.onNodeWithText("←  More").assertDoesNotExist()
    }

    @Test
    fun theSectionsAreLabelled() {
        compose.setContent { SettingsContent(state, Taps().actions(), 0.dp, Modifier.requiredHeight(3000.dp)) }
        listOf("APPEARANCE", "PRIVACY AND INPUT", "SYNC", "ACCOUNT", "UPDATES AND ABOUT").forEach { compose.onNodeWithText(it).assertExists() }
    }

    @Test
    fun everyControlThatExistedBeforeIsStillThere() {
        compose.setContent { SettingsContent(state.copy(unsent = 2, attention = 1), Taps().actions(), 0.dp, Modifier.requiredHeight(3000.dp)) }
        listOf(
            "Light", "Dark", "System",
            "Hide amounts", "Type amounts from the cents", "Allow screenshots",
            "Keep my filters", "Until I leave Transactions", "Until I close the app", "For a time I choose",
            "Check for updates automatically", "Check for updates",
            "Refresh everything", "Lock now", "Sign out",
        ).forEach { compose.onNodeWithText(it, useUnmergedTree = true).assertExists() }
        compose.onNodeWithText("2 changes not sent yet", substring = true).assertExists()
        compose.onNodeWithText("1 change", substring = true).assertExists()
    }

    @Test
    fun lockSignOutRefreshAndAttentionEachDoTheirOwnThing() {
        val taps = Taps()
        compose.setContent { SettingsContent(state.copy(attention = 2), taps.actions(), 0.dp, Modifier.requiredHeight(3000.dp)) }
        compose.onNodeWithText("Lock now").performClick()
        assertEquals(listOf(1, 0, 0, 0), listOf(taps.locked, taps.signedOut, taps.refreshed, taps.attentionOpened))
        compose.onNodeWithText("Sign out").performClick()
        assertEquals(listOf(1, 1, 0, 0), listOf(taps.locked, taps.signedOut, taps.refreshed, taps.attentionOpened))
        compose.onNodeWithText("Refresh everything").performClick()
        compose.onNodeWithText("2 changes need your attention", substring = true).performClick()
        assertEquals(listOf(1, 1, 1, 1), listOf(taps.locked, taps.signedOut, taps.refreshed, taps.attentionOpened))
    }

    @Test
    fun theAppAndApiVersionsStayUnderUpdatesAndAbout() {
        compose.setContent { SettingsContent(state, Taps().actions(), 0.dp, Modifier.requiredHeight(3000.dp)) }
        compose.onNodeWithText("Version ${app.ledgerline.android.BuildConfig.VERSION_NAME}").assertExists()
        compose.onNodeWithText("Built for API ${app.ledgerline.android.BuildConfig.API_VERSION}").assertExists()
    }

    @Test
    fun theThemeHintAndEachSwitchSentenceStayAsRowSubtitles() {
        compose.setContent { SettingsContent(state, Taps().actions(), 0.dp, Modifier.requiredHeight(3000.dp)) }
        compose.onNodeWithText("Follows your phone").assertExists()
        compose.onNodeWithText("Show amounts as dots").assertExists()
        compose.onNodeWithText("Show the app in screenshots and recent apps").assertExists()
    }

    @Test
    fun theTopBarPillSaysTheSyncState() {
        val words = mapOf(
            SyncPill.Synced to "Synced", SyncPill.Updating to "Updating", SyncPill.Offline to "Offline",
            SyncPill.Failed to "Not updated", SyncPill.NotSent to "Not sent yet",
        )
        var shown by mutableStateOf(SyncPill.Synced)
        compose.setContent { SettingsContent(state.copy(pill = shown), Taps().actions(), 0.dp, Modifier.requiredHeight(3000.dp)) }
        words.forEach { (pill, text) ->
            shown = pill
            compose.waitForIdle()
            compose.onNodeWithText(text, useUnmergedTree = true).assertExists()
        }
    }

    @Test
    fun theSyncPillShowsOneStateByPriority() {
        val idle = SyncLine("2026-10-24T10:00:00Z", running = false, problem = null)
        assertEquals(SyncPill.Synced, syncPill(idle, 0))
        assertEquals(SyncPill.NotSent, syncPill(idle, 3))
        assertEquals(SyncPill.Offline, syncPill(idle.copy(problem = SyncProblem.Offline), 3))
        assertEquals(SyncPill.Failed, syncPill(idle.copy(problem = SyncProblem.Failed), 3))
        assertEquals(SyncPill.Updating, syncPill(idle.copy(running = true, problem = SyncProblem.Offline), 3))
    }

    @Test
    fun signOutIsTheRedActionAndLockNowIsNot() {
        val rows = accountActions(canLock = true, signingOut = false)
        assertEquals(listOf(AccountAction.Lock, AccountAction.SignOut), rows.map { it.action })
        assertTrue(rows.single { it.action == AccountAction.SignOut }.danger)
        assertFalse(rows.single { it.action == AccountAction.Lock }.danger)
    }

    @Test
    fun withoutLockingThereIsNoLockNowAndSigningOutDisablesTheButton() {
        assertEquals(listOf(AccountAction.SignOut), accountActions(canLock = false, signingOut = false).map { it.action })
        assertFalse(accountActions(canLock = false, signingOut = true).single().enabled)
        compose.setContent { SettingsContent(state.copy(canLock = false, signingOut = true), Taps().actions(), 0.dp, Modifier.requiredHeight(3000.dp)) }
        compose.onNodeWithText("Lock now").assertDoesNotExist()
        compose.onNodeWithText("Sign out").assertIsNotEnabled()
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

    /** The redesign is clutter-free (ADR 0046): a row's hint is one short line, never a paragraph. */
    @Test
    fun everyRowHintOnMoreAndSettingsIsShort() {
        val app = org.robolectric.RuntimeEnvironment.getApplication()
        val hints = listOf(
            R.string.theme_detail, R.string.privacy_mode_detail, R.string.cents_first_detail, R.string.allow_screenshots_detail,
            R.string.filters_keep_detail, R.string.updates_auto_detail,
            R.string.more_clients_detail, R.string.more_loans_detail, R.string.more_categories_detail, R.string.more_settings_detail,
        )
        hints.forEach { id ->
            val text = app.getString(id)
            assertTrue("$text (${text.length} characters)", text.length <= 60)
        }
    }
}
