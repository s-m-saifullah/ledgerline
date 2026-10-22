package app.ledgerline.android.session

import app.ledgerline.api.SessionToken
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/** Why a session ended without the owner signing out cleanly; shown once on the sign-in screen. */
enum class SessionEnd {
    /** The server no longer accepts the token (it expired or was removed under Settings). */
    Expired,

    /** The owner signed out but the server could not be reached, so the session stays listed on the server. */
    ServerNotReached,

    /** The phone's screen lock or fingerprints changed, so the stored token could no longer be opened. */
    KeyLost,
}

/** Where the owner is in signing in and out. The token is in memory only in [Offer] and [Unlocked]. */
sealed interface SessionState {
    /** No session; show sign-in. */
    data object SignedOut : SessionState

    /** A token is stored on the phone but not open; show the lock screen. */
    data object Locked : SessionState

    /** Just signed in; ask whether to keep the session on the phone. */
    data object Offer : SessionState

    data object Unlocked : SessionState
}

fun interface Clock {
    fun nowMillis(): Long
}

/** The lock after the app has been in the background for this long. */
const val LockAfterMillis = 60_000L

/**
 * The session: the token in memory, the encrypted copy on the phone (through [TokenProtector]) and the lock.
 * A token reaches the phone's storage only when the owner confirms it ([protect]); a failed or cancelled
 * confirmation leaves nothing stored. Locking forgets the in-memory token; unlocking needs the owner again.
 */
@Singleton
class SessionManager @Inject constructor(
    private val protector: TokenProtector,
    private val clock: Clock,
) {
    private val tokenState = MutableStateFlow<SessionToken?>(null)
    private val sessionState = MutableStateFlow<SessionState>(
        if (protector.hasStored()) SessionState.Locked else SessionState.SignedOut,
    )
    private val endState = MutableStateFlow<SessionEnd?>(null)
    private var backgroundedAt: Long? = null

    /** The open token, for the HTTP clients; null while locked or signed out. */
    val token: StateFlow<SessionToken?> = tokenState.asStateFlow()
    val state: StateFlow<SessionState> = sessionState.asStateFlow()
    val ended: StateFlow<SessionEnd?> = endState.asStateFlow()

    fun protection(): Protection = protector.protection()

    /** True when the session is kept on the phone, so locking returns to the lock screen instead of signing out. */
    fun canLock(): Boolean = protector.hasStored()

    /** A sign-in finished: hold the token in memory and offer to keep it on the phone. */
    fun signedIn(token: SessionToken) {
        endState.value = null
        tokenState.value = token
        sessionState.value = SessionState.Offer
    }

    /** The owner chose to keep the session on the phone. Stays on the offer unless it was saved. */
    suspend fun protect(): ProtectOutcome {
        val token = tokenState.value ?: return ProtectOutcome.Failed()
        val outcome = protector.protect(token)
        if (outcome == ProtectOutcome.Saved) sessionState.value = SessionState.Unlocked
        return outcome
    }

    /** The owner chose not to keep it: the session lives in memory until the app is closed or locked. */
    fun skipProtect() {
        if (sessionState.value == SessionState.Offer) sessionState.value = SessionState.Unlocked
    }

    suspend fun unlock(): UnlockOutcome {
        if (sessionState.value != SessionState.Locked) return UnlockOutcome.Failed()
        val outcome = protector.unlock()
        when (outcome) {
            is UnlockOutcome.Unlocked -> {
                tokenState.value = outcome.token
                sessionState.value = SessionState.Unlocked
            }
            UnlockOutcome.KeyLost -> endSession(SessionEnd.KeyLost)
            UnlockOutcome.Cancelled, is UnlockOutcome.Failed -> Unit
        }
        return outcome
    }

    /** Forgets the open token. A stored one stays and the lock screen shows; with none stored this is a sign-out. */
    fun lock() {
        if (sessionState.value == SessionState.Locked || sessionState.value == SessionState.SignedOut) return
        tokenState.value = null
        sessionState.value = if (protector.hasStored()) SessionState.Locked else SessionState.SignedOut
    }

    /** Ends the session on this phone: deletes the stored token and its key and forgets the open token. */
    fun endSession(reason: SessionEnd? = null) {
        protector.discard()
        tokenState.value = null
        endState.value = reason
        sessionState.value = SessionState.SignedOut
    }

    fun noticeShown() {
        endState.value = null
    }

    fun appWentToBackground() {
        backgroundedAt = clock.nowMillis()
    }

    /** Locks if the app was away for [LockAfterMillis] or more. */
    fun appCameToForeground() {
        val since = backgroundedAt ?: return
        backgroundedAt = null
        if (clock.nowMillis() - since >= LockAfterMillis) lock()
    }
}
