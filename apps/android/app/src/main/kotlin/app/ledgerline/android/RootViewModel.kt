package app.ledgerline.android

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.server.ServerAddressStore
import app.ledgerline.android.session.SessionStore
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

/** Which screen the app shows: decided from the saved address and the session. */
sealed interface RootState {
    data object Loading : RootState

    /** [canCancel] is true when an address is already saved and the owner chose to change it. */
    data class Address(val canCancel: Boolean) : RootState

    data class SignIn(val origin: String) : RootState

    data class SignedIn(val origin: String) : RootState
}

@HiltViewModel
class RootViewModel @Inject constructor(
    private val addressStore: ServerAddressStore,
    session: SessionStore,
) : ViewModel() {
    private val changingAddress = MutableStateFlow(false)

    val state: StateFlow<RootState> = combine(
        addressStore.origin,
        session.token,
        changingAddress,
    ) { origin, token, changing ->
        when {
            origin == null -> RootState.Address(canCancel = false)
            changing -> RootState.Address(canCancel = true)
            token == null -> RootState.SignIn(origin)
            else -> RootState.SignedIn(origin)
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), RootState.Loading)

    fun changeAddress() {
        changingAddress.value = true
    }

    fun addressDone() {
        changingAddress.value = false
    }
}
