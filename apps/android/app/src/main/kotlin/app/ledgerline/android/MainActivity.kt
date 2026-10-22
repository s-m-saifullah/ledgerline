package app.ledgerline.android

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.fragment.app.FragmentActivity
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        promptHost.activity = this
        enableEdgeToEdge()
        setContent {
            LedgerlineTheme {
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

    override fun onDestroy() {
        if (promptHost.activity === this) promptHost.activity = null
        super.onDestroy()
    }
}
