package app.ledgerline.android.settings

import android.content.Context
import androidx.core.content.edit
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Choices kept on this phone only, like the web app's preferences (ADR 0043, slice 5). They stay through
 * sign-out because they belong to the phone, not to the session. Read synchronously, so the screenshot rule
 * is in place before the first frame is drawn.
 */
interface PhoneSettings {
    /** Every amount shows as a mask. Off by default. */
    val privacyMode: StateFlow<Boolean>

    /** Screenshots, screen recording and the recents preview may show the app. Off by default (FLAG_SECURE). */
    val allowScreenshots: StateFlow<Boolean>

    fun setPrivacyMode(on: Boolean)

    fun setAllowScreenshots(allow: Boolean)
}

@Singleton
class PrefsPhoneSettings @Inject constructor(@ApplicationContext context: Context) : PhoneSettings {
    private val prefs = context.getSharedPreferences("phone-settings", Context.MODE_PRIVATE)
    private val _privacyMode = MutableStateFlow(prefs.getBoolean(PrivacyMode, false))
    private val _allowScreenshots = MutableStateFlow(prefs.getBoolean(AllowScreenshots, false))

    override val privacyMode: StateFlow<Boolean> = _privacyMode.asStateFlow()
    override val allowScreenshots: StateFlow<Boolean> = _allowScreenshots.asStateFlow()

    override fun setPrivacyMode(on: Boolean) {
        prefs.edit(commit = true) { putBoolean(PrivacyMode, on) }
        _privacyMode.value = on
    }

    override fun setAllowScreenshots(allow: Boolean) {
        prefs.edit(commit = true) { putBoolean(AllowScreenshots, allow) }
        _allowScreenshots.value = allow
    }

    private companion object {
        const val PrivacyMode = "privacyMode"
        const val AllowScreenshots = "allowScreenshots"
    }
}

@Module
@InstallIn(SingletonComponent::class)
abstract class SettingsModule {
    @Binds
    abstract fun bindPhoneSettings(settings: PrefsPhoneSettings): PhoneSettings
}
