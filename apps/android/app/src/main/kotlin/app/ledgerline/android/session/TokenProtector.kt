package app.ledgerline.android.session

import app.ledgerline.api.SessionToken

/** Whether the phone can protect a token with a fingerprint or screen lock. */
enum class Protection { Available, NoScreenLock, Unavailable }

sealed interface ProtectOutcome {
    data object Saved : ProtectOutcome
    data object Cancelled : ProtectOutcome

    /**
     * [lockedOut] is true when the phone refused further attempts for a while. [detail] is a short reason code
     * (an error number or an exception class, never a secret) that debug builds show.
     */
    data class Failed(val lockedOut: Boolean = false, val detail: String? = null) : ProtectOutcome
}

sealed interface UnlockOutcome {
    data class Unlocked(val token: SessionToken) : UnlockOutcome
    data object Cancelled : UnlockOutcome

    /** The saved sign-in can no longer be opened (the phone's screen lock was removed, data was cleared, the copy is damaged). */
    data object KeyLost : UnlockOutcome
    data class Failed(val lockedOut: Boolean = false, val detail: String? = null) : UnlockOutcome
}

/**
 * Keeps the session token on the phone, encrypted under a Keystore key, behind the owner's fingerprint or screen
 * lock: the app asks for it before it stores or opens the token (ADR 0043). Nothing here talks to the server.
 */
interface TokenProtector {
    fun protection(): Protection

    /** True when an encrypted token is stored. */
    fun hasStored(): Boolean

    /** Asks the owner to confirm, then stores [token] encrypted. Stores nothing unless it returns [ProtectOutcome.Saved]. */
    suspend fun protect(token: SessionToken): ProtectOutcome

    /** Asks the owner to confirm, then returns the stored token. */
    suspend fun unlock(): UnlockOutcome

    /** Deletes the stored token and its key. Safe to call when nothing is stored. */
    fun discard()
}
