package app.ledgerline.android

import android.os.Bundle
import android.graphics.Color
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.DisposableEffect
import androidx.activity.viewModels
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import app.ledgerline.android.settings.PhoneSettings
import app.ledgerline.android.ui.editor.LocalCentsFirst
import app.ledgerline.android.ui.privacy.LocalPrivacy
import app.ledgerline.android.ui.privacy.applyScreenshotRule
import kotlinx.coroutines.launch
import app.ledgerline.android.session.PromptHost
import app.ledgerline.android.ui.lock.KeepSignedInScreen
import app.ledgerline.android.ui.lock.LockedScreen
import javax.inject.Inject
import app.ledgerline.android.ui.address.AddressScreen
import app.ledgerline.android.ui.home.SignedInScreen
import app.ledgerline.android.ui.signin.SignInScreen
import app.ledgerline.android.ui.theme.LedgerlineTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
/** A FragmentActivity because the system fingerprint prompt needs one. */
class MainActivity : FragmentActivity() {
    private val root: RootViewModel by viewModels()

    @Inject
    lateinit var promptHost: PromptHost

    @Inject
    lateinit var settings: PhoneSettings

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        promptHost.activity = this
        // Before the first frame, so nothing is ever captured; then whenever the owner changes the switch.
        window.applyScreenshotRule(settings.allowScreenshots.value)
        lifecycleScope.launch { settings.allowScreenshots.collect { window.applyScreenshotRule(it) } }
        enableEdgeToEdge()
        setContent {
            val privacy by settings.privacyMode.collectAsState()
            val centsFirst by settings.centsFirst.collectAsState()
            val choice by settings.theme.collectAsState()
            val dark = choice.isDark(isSystemInDarkTheme())
            // The system bars' icons follow the app's theme, not only the phone's.
            DisposableEffect(dark) {
                enableEdgeToEdge(
                    statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT) { dark },
                    navigationBarStyle = SystemBarStyle.auto(LightNavigationScrim, DarkNavigationScrim) { dark },
                )
                onDispose { }
            }
            CompositionLocalProvider(LocalPrivacy provides privacy, LocalCentsFirst provides centsFirst) {
                LedgerlineTheme(darkTheme = dark) {
                    val state by root.state.collectAsState()
                    when (val current = state) {
                        RootState.Loading -> Unit
                        is RootState.Address -> AddressScreen(canCancel = current.canCancel, onDone = root::addressDone)
                        is RootState.SignIn -> SignInScreen(origin = current.origin, onChangeAddress = root::changeAddress)
                        RootState.Locked -> LockedScreen()
                        RootState.Offer -> KeepSignedInScreen()
                        is RootState.SignedIn -> SignedInScreen()
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        if (promptHost.activity === this) promptHost.activity = null
        super.onDestroy()
    }
}

// The scrims enableEdgeToEdge uses by default, for the bars' three-button style.
private val LightNavigationScrim = Color.argb(0xe6, 0xFF, 0xFF, 0xFF)
private val DarkNavigationScrim = Color.argb(0x80, 0x1b, 0x1b, 0x1b)
