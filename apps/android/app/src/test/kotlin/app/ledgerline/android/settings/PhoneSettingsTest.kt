package app.ledgerline.android.settings

import android.content.Context
import androidx.test.core.app.ApplicationProvider
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
}
