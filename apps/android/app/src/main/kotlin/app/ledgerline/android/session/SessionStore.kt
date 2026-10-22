package app.ledgerline.android.session

import app.ledgerline.api.SessionToken
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The signed-in session. For now it lives in memory only, so closing the app signs out; a later change keeps
 * the token encrypted behind the biometric lock (ADR 0043).
 */
interface SessionStore {
    val token: StateFlow<SessionToken?>

    /** Why the last session ended without the owner signing out cleanly, shown once on the sign-in screen. */
    val ended: StateFlow<SessionEnd?>

    fun set(token: SessionToken)

    fun clear(reason: SessionEnd? = null)

    fun noticeShown()
}

enum class SessionEnd {
    /** The server no longer accepts the token (it expired or was removed under Settings). */
    Expired,

    /** The owner signed out but the server could not be reached, so the session stays listed on the server. */
    ServerNotReached,
}

@Singleton
class InMemorySessionStore @Inject constructor() : SessionStore {
    private val state = MutableStateFlow<SessionToken?>(null)
    private val endState = MutableStateFlow<SessionEnd?>(null)
    override val token: StateFlow<SessionToken?> = state.asStateFlow()
    override val ended: StateFlow<SessionEnd?> = endState.asStateFlow()

    override fun set(token: SessionToken) {
        endState.value = null
        state.value = token
    }

    override fun clear(reason: SessionEnd?) {
        endState.value = reason
        state.value = null
    }

    override fun noticeShown() {
        endState.value = null
    }
}
