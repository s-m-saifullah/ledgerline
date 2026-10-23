package app.ledgerline.android.ui.settings

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
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
        unsent = 0,
        attention = 0,
        canLock = true,
        signingOut = false,
    )

    private class Taps {
        val themes = mutableListOf<ThemeChoice>()
        val cents = mutableListOf<Boolean>()
        val hide = mutableListOf<Boolean>()
        var back = 0

        fun actions() = SettingsActions(
            onBack = { back++ },
            setTheme = { themes += it },
            setHideAmounts = { hide += it },
            setCentsFirst = { cents += it },
            setAllowScreenshots = {},
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
}
