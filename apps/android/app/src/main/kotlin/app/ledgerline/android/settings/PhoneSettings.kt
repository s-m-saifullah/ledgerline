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

/** The theme choice, as the web's Appearance setting: the phone's own light or dark mode, or one fixed. */
enum class ThemeChoice {
    Light,
    Dark,
    System,
    ;

    /** Whether the app is drawn dark, given whether the phone itself is in dark mode. */
    fun isDark(systemDark: Boolean): Boolean = when (this) {
        Light -> false
        Dark -> true
        System -> systemDark
    }
}

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

    /** Light, dark or the phone's own. System by default. */
    val theme: StateFlow<ThemeChoice>

    /** Typed digits fill in from the right of the amount box (1, 2, 3 reads 1.23). Off by default, as on the web. */
    val centsFirst: StateFlow<Boolean>

    /** How long the Transactions filters stay. Until the app closes by default. */
    val filterKeep: StateFlow<FilterKeep>

    /** Look for a newer release once a day when the app opens (ADR 0043). On by default; the Settings button always works. */
    val autoUpdateCheck: StateFlow<Boolean>

    fun setPrivacyMode(on: Boolean)

    fun setAllowScreenshots(allow: Boolean)

    fun setTheme(choice: ThemeChoice)

    fun setCentsFirst(on: Boolean)

    fun setFilterKeep(keep: FilterKeep)

    fun setAutoUpdateCheck(on: Boolean)
}

@Singleton
class PrefsPhoneSettings @Inject constructor(@ApplicationContext context: Context) : PhoneSettings {
    private val prefs = context.getSharedPreferences("phone-settings", Context.MODE_PRIVATE)
    private val _privacyMode = MutableStateFlow(prefs.getBoolean(PrivacyMode, false))
    private val _allowScreenshots = MutableStateFlow(prefs.getBoolean(AllowScreenshots, false))
    private val _theme = MutableStateFlow(
        ThemeChoice.entries.find { it.name == prefs.getString(Theme, null) } ?: ThemeChoice.System,
    )
    private val _centsFirst = MutableStateFlow(prefs.getBoolean(CentsFirst, false))
    private val _autoUpdateCheck = MutableStateFlow(prefs.getBoolean(AutoUpdateCheck, true))
    private val _filterKeep = MutableStateFlow(
        FilterKeep(
            mode = KeepMode.entries.find { it.name == prefs.getString(KeepModeKey, null) } ?: KeepMode.UntilAppCloses,
            amount = prefs.getInt(KeepAmountKey, 1).takeIf { it in 1..MaxKeepAmount } ?: 1,
            unit = KeepUnit.entries.find { it.name == prefs.getString(KeepUnitKey, null) } ?: KeepUnit.Hours,
        ),
    )

    override val privacyMode: StateFlow<Boolean> = _privacyMode.asStateFlow()
    override val allowScreenshots: StateFlow<Boolean> = _allowScreenshots.asStateFlow()
    override val theme: StateFlow<ThemeChoice> = _theme.asStateFlow()
    override val centsFirst: StateFlow<Boolean> = _centsFirst.asStateFlow()
    override val filterKeep: StateFlow<FilterKeep> = _filterKeep.asStateFlow()
    override val autoUpdateCheck: StateFlow<Boolean> = _autoUpdateCheck.asStateFlow()

    override fun setPrivacyMode(on: Boolean) {
        prefs.edit(commit = true) { putBoolean(PrivacyMode, on) }
        _privacyMode.value = on
    }

    override fun setAllowScreenshots(allow: Boolean) {
        prefs.edit(commit = true) { putBoolean(AllowScreenshots, allow) }
        _allowScreenshots.value = allow
    }

    override fun setTheme(choice: ThemeChoice) {
        prefs.edit(commit = true) { putString(Theme, choice.name) }
        _theme.value = choice
    }

    override fun setCentsFirst(on: Boolean) {
        prefs.edit(commit = true) { putBoolean(CentsFirst, on) }
        _centsFirst.value = on
    }

    override fun setFilterKeep(keep: FilterKeep) {
        prefs.edit(commit = true) {
            putString(KeepModeKey, keep.mode.name)
            putInt(KeepAmountKey, keep.amount)
            putString(KeepUnitKey, keep.unit.name)
        }
        _filterKeep.value = keep
    }

    override fun setAutoUpdateCheck(on: Boolean) {
        prefs.edit(commit = true) { putBoolean(AutoUpdateCheck, on) }
        _autoUpdateCheck.value = on
    }

    private companion object {
        const val AutoUpdateCheck = "autoUpdateCheck"
        const val PrivacyMode = "privacyMode"
        const val AllowScreenshots = "allowScreenshots"
        const val Theme = "theme"
        const val CentsFirst = "centsFirst"
        const val KeepModeKey = "filterKeepMode"
        const val KeepAmountKey = "filterKeepAmount"
        const val KeepUnitKey = "filterKeepUnit"
    }
}

@Module
@InstallIn(SingletonComponent::class)
abstract class SettingsModule {
    @Binds
    abstract fun bindPhoneSettings(settings: PrefsPhoneSettings): PhoneSettings
}
