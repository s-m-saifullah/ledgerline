package app.ledgerline.android.settings

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The phone's own choices: private by default (screenshots blocked), and kept across restarts. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PhoneSettingsTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun screenshotsAreBlockedAndAmountsShownByDefault() {
        val settings = PrefsPhoneSettings(context)
        assertFalse(settings.allowScreenshots.value)
        assertFalse(settings.privacyMode.value)
    }

    @Test
    fun choicesAreKeptForTheNextStart() {
        val settings = PrefsPhoneSettings(context)
        settings.setPrivacyMode(true)
        settings.setAllowScreenshots(true)
        assertTrue(settings.privacyMode.value)
        assertTrue(settings.allowScreenshots.value)

        val later = PrefsPhoneSettings(context)
        assertTrue(later.privacyMode.value)
        assertTrue(later.allowScreenshots.value)

        later.setAllowScreenshots(false)
        assertFalse(PrefsPhoneSettings(context).allowScreenshots.value)
    }

    @Test
    fun automaticUpdateChecksAreOnByDefaultAndTheChoiceIsKept() {
        assertTrue(PrefsPhoneSettings(context).autoUpdateCheck.value)
        PrefsPhoneSettings(context).setAutoUpdateCheck(false)
        assertFalse(PrefsPhoneSettings(context).autoUpdateCheck.value)
        PrefsPhoneSettings(context).setAutoUpdateCheck(true)
        assertTrue(PrefsPhoneSettings(context).autoUpdateCheck.value)
    }

    @Test
    fun themeFollowsThePhoneAndAmountsAreTypedTheUsualWayByDefault() {
        val settings = PrefsPhoneSettings(context)
        assertEquals(ThemeChoice.System, settings.theme.value)
        assertFalse(settings.centsFirst.value)
    }

    @Test
    fun themeAndAmountEntryAreKeptForTheNextStart() {
        val settings = PrefsPhoneSettings(context)
        settings.setTheme(ThemeChoice.Dark)
        settings.setCentsFirst(true)
        assertEquals(ThemeChoice.Dark, settings.theme.value)
        assertTrue(settings.centsFirst.value)

        val later = PrefsPhoneSettings(context)
        assertEquals(ThemeChoice.Dark, later.theme.value)
        assertTrue(later.centsFirst.value)

        later.setTheme(ThemeChoice.Light)
        later.setCentsFirst(false)
        assertEquals(ThemeChoice.Light, PrefsPhoneSettings(context).theme.value)
        assertFalse(PrefsPhoneSettings(context).centsFirst.value)
    }

    @Test
    fun anUnknownStoredThemeFallsBackToSystem() {
        context.getSharedPreferences("phone-settings", Context.MODE_PRIVATE).edit().putString("theme", "Sepia").commit()
        assertEquals(ThemeChoice.System, PrefsPhoneSettings(context).theme.value)
    }

    @Test
    fun aFixedThemeIgnoresThePhoneAndSystemFollowsIt() {
        assertFalse(ThemeChoice.Light.isDark(systemDark = true))
        assertTrue(ThemeChoice.Dark.isDark(systemDark = false))
        assertTrue(ThemeChoice.System.isDark(systemDark = true))
        assertFalse(ThemeChoice.System.isDark(systemDark = false))
    }
}
