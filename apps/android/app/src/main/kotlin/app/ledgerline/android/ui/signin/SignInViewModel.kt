package app.ledgerline.android.ui.signin

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.server.ServerAddressStore
import app.ledgerline.android.session.ClientsProvider
import app.ledgerline.android.session.SessionEnd
import app.ledgerline.android.session.SessionManager
import app.ledgerline.api.Challenge
import app.ledgerline.api.SignInFailure
import app.ledgerline.api.SignInResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class SignInStep { Password, Code }

enum class SignInProblem { MissingFields, MissingCode, BadCredentials, WrongCode, RateLimited, AddressRejected, Server, Network, Unexpected }

data class SignInUiState(
    val step: SignInStep = SignInStep.Password,
    val email: String = "",
    val password: String = "",
    val code: String = "",
    val useBackupCode: Boolean = false,
    val submitting: Boolean = false,
    val problem: SignInProblem? = null,
)

@HiltViewModel
class SignInViewModel @Inject constructor(
    private val addressStore: ServerAddressStore,
    private val clients: ClientsProvider,
    private val session: SessionManager,
) : ViewModel() {
    private val _state = MutableStateFlow(SignInUiState())
    val state: StateFlow<SignInUiState> = _state.asStateFlow()

    /** Why the previous session ended, if it did not end with the owner signing out cleanly. */
    val ended: StateFlow<SessionEnd?> = session.ended

    // The challenge and the password never go into UI state longer than needed and are never saved.
    private var challenge: Challenge? = null

    fun onEmail(text: String) = _state.update { it.copy(email = text, problem = null) }

    fun onPassword(text: String) = _state.update { it.copy(password = text, problem = null) }

    fun onCode(text: String) = _state.update { it.copy(code = text, problem = null) }

    fun onUseBackupCode(use: Boolean) = _state.update { it.copy(useBackupCode = use, code = "", problem = null) }

    fun dismissNotice() = session.noticeShown()

    fun backToPassword() {
        challenge = null
        _state.update { it.copy(step = SignInStep.Password, code = "", useBackupCode = false, problem = null) }
    }

    fun submit() {
        val current = _state.value
        if (current.submitting) return
        val problem = when {
            current.step == SignInStep.Password && (current.email.isBlank() || current.password.isEmpty()) -> SignInProblem.MissingFields
            current.step == SignInStep.Code && current.code.isBlank() -> SignInProblem.MissingCode
            else -> null
        }
        if (problem != null) {
            _state.update { it.copy(problem = problem) }
            return
        }
        _state.update { it.copy(submitting = true, problem = null) }
        viewModelScope.launch {
            val origin = addressStore.origin.first()
            if (origin == null) {
                _state.update { it.copy(submitting = false, problem = SignInProblem.Unexpected) }
                return@launch
            }
            val auth = clients.forOrigin(origin).auth
            val result = when (current.step) {
                SignInStep.Password -> auth.signIn(current.email, current.password)
                SignInStep.Code -> {
                    val pending = challenge
                    if (pending == null) SignInResult.Failed(SignInFailure.Unexpected)
                    else auth.verifyCode(pending, current.code, current.useBackupCode)
                }
            }
            when (result) {
                is SignInResult.SignedIn -> {
                    challenge = null
                    // The session first, then the form: anything that sees the form finished must see the session.
                    session.signedIn(result.token)
                    _state.value = SignInUiState(email = current.email)
                }
                is SignInResult.NeedsCode -> {
                    challenge = result.challenge
                    _state.update { it.copy(step = SignInStep.Code, password = "", code = "", submitting = false) }
                }
                is SignInResult.Failed -> _state.update { it.copy(submitting = false, problem = result.failure.toProblem()) }
            }
        }
    }

    private fun SignInFailure.toProblem() = when (this) {
        SignInFailure.BadCredentials -> SignInProblem.BadCredentials
        SignInFailure.WrongCode -> SignInProblem.WrongCode
        is SignInFailure.RateLimited -> SignInProblem.RateLimited
        SignInFailure.AddressRejected -> SignInProblem.AddressRejected
        SignInFailure.Server -> SignInProblem.Server
        SignInFailure.Network -> SignInProblem.Network
        SignInFailure.Unexpected -> SignInProblem.Unexpected
    }
}
