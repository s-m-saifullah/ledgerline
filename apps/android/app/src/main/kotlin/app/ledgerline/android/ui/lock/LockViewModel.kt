package app.ledgerline.android.ui.lock

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.session.ProtectOutcome
import app.ledgerline.android.session.Protection
import app.ledgerline.android.session.SessionManager
import app.ledgerline.android.session.UnlockOutcome
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class LockProblem { Failed, LockedOut }

data class LockUiState(val busy: Boolean = false, val problem: LockProblem? = null, val detail: String? = null)

/** The lock screen (a stored session is closed) and the offer after sign-in (keep it on this phone?). */
@HiltViewModel
class LockViewModel @Inject constructor(private val session: SessionManager) : ViewModel() {
    private val _state = MutableStateFlow(LockUiState())
    val state: StateFlow<LockUiState> = _state.asStateFlow()

    val protection: Protection get() = session.protection()

    fun unlock() {
        if (_state.value.busy) return
        _state.value = LockUiState(busy = true)
        viewModelScope.launch {
            _state.value = when (val outcome = session.unlock()) {
                is UnlockOutcome.Failed -> LockUiState(problem = if (outcome.lockedOut) LockProblem.LockedOut else LockProblem.Failed, detail = outcome.detail)
                else -> LockUiState()
            }
        }
    }

    fun protect() {
        if (_state.value.busy) return
        _state.value = LockUiState(busy = true)
        viewModelScope.launch {
            _state.value = when (val outcome = session.protect()) {
                is ProtectOutcome.Failed -> LockUiState(problem = if (outcome.lockedOut) LockProblem.LockedOut else LockProblem.Failed, detail = outcome.detail)
                else -> LockUiState()
            }
        }
    }

    fun notNow() = session.skipProtect()

    /** Forgets the stored session on this phone and goes to sign-in; the server keeps listing it until it expires. */
    fun signInAgain() = session.endSession(null)
}
