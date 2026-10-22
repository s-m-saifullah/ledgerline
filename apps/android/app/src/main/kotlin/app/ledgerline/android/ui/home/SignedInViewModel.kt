package app.ledgerline.android.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.server.ServerAddressStore
import app.ledgerline.android.session.ClientsProvider
import app.ledgerline.android.session.SessionEnd
import app.ledgerline.android.session.SessionManager
import app.ledgerline.api.LedgerSummary
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import retrofit2.HttpException
import java.io.IOException
import javax.inject.Inject

sealed interface LedgersState {
    data object Loading : LedgersState
    data class Loaded(val ledgers: List<LedgerSummary>) : LedgersState
    data object Failed : LedgersState
}

@HiltViewModel
class SignedInViewModel @Inject constructor(
    private val addressStore: ServerAddressStore,
    private val clients: ClientsProvider,
    private val session: SessionManager,
) : ViewModel() {
    private val _state = MutableStateFlow<LedgersState>(LedgersState.Loading)
    val state: StateFlow<LedgersState> = _state.asStateFlow()

    private val _signingOut = MutableStateFlow(false)
    val signingOut: StateFlow<Boolean> = _signingOut.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.value = LedgersState.Loading
        viewModelScope.launch {
            val origin = addressStore.origin.first() ?: return@launch
            _state.value = try {
                LedgersState.Loaded(clients.forOrigin(origin).api.ledgers().items)
            } catch (e: HttpException) {
                if (e.code() == 401) {
                    session.endSession(SessionEnd.Expired)
                    return@launch
                }
                LedgersState.Failed
            } catch (_: IOException) {
                LedgersState.Failed
            }
        }
    }

    /** Whether the session is kept on the phone, so it can be locked instead of ended. */
    val canLock: Boolean get() = session.canLock()

    fun lock() = session.lock()

    fun signOut() {
        if (_signingOut.value) return
        _signingOut.value = true
        viewModelScope.launch {
            val origin = addressStore.origin.first()
            val ended = origin?.let { clients.forOrigin(it).auth.signOut() } ?: false
            _signingOut.value = false
            session.endSession(if (ended) null else SessionEnd.ServerNotReached)
        }
    }
}
