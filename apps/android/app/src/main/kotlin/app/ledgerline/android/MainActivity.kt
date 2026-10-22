package app.ledgerline.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import app.ledgerline.android.ui.address.AddressScreen
import app.ledgerline.android.ui.home.SignedInScreen
import app.ledgerline.android.ui.signin.SignInScreen
import app.ledgerline.android.ui.theme.LedgerlineTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    private val root: RootViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            LedgerlineTheme {
                val state by root.state.collectAsState()
                when (val current = state) {
                    RootState.Loading -> Unit
                    is RootState.Address -> AddressScreen(canCancel = current.canCancel, onDone = root::addressDone)
                    is RootState.SignIn -> SignInScreen(origin = current.origin, onChangeAddress = root::changeAddress)
                    is RootState.SignedIn -> SignedInScreen(origin = current.origin)
                }
            }
        }
    }
}
