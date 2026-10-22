package app.ledgerline.android.sync

import app.ledgerline.android.mirror.PullResult
import app.ledgerline.android.mirror.SyncEngine
import app.ledgerline.android.session.Clock
import app.ledgerline.android.session.SessionEnd
import app.ledgerline.android.session.SessionManager
import app.ledgerline.android.session.SessionState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

enum class BackgroundOutcome { Done, Retry, Stop }

/**
 * Decides when the mirror is pulled and when it is deleted (ADR 0043), from what the session does:
 *
 * - a sign-in is followed by a full refresh; so is "Refresh everything";
 * - the app opening, or coming back to the front, pulls (not more often than every 30 seconds);
 * - a session kept on the phone gets the periodic background pull, which may use the stored token while locked;
 * - signing out, or losing the key, cancels the job and deletes the mirror, waiting for a pull in progress;
 * - an expired session (401) keeps the mirror and shows sign-in again.
 */
@Singleton
class SyncCoordinator @Inject constructor(
    private val session: SessionManager,
    private val runner: SyncRunner,
    private val engine: SyncEngine,
    private val scheduler: SyncScheduler,
    private val choice: LedgerChoice,
    private val clock: Clock,
) {
    private var scope: CoroutineScope? = null
    private var previous: SessionState? = null
    private var needsFullRefresh = false
    private var lastPullAt: Long? = null

    private val _last = MutableStateFlow<PullResult?>(null)

    /** The result of the latest pull, for the "last updated" and error lines. */
    val last: StateFlow<PullResult?> = _last.asStateFlow()

    fun start(scope: CoroutineScope) {
        this.scope = scope
        scope.launch { session.state.collectLatest { onState(it) } }
    }

    fun appCameToForeground() {
        scope?.launch { foregroundPull() }
    }

    suspend fun onState(state: SessionState) {
        val before = previous
        previous = state
        when (state) {
            SessionState.Offer -> {
                // A new sign-in: forget the old ledger choice and start from a full refresh.
                needsFullRefresh = true
                choice.clear()
            }
            SessionState.Locked -> scheduler.schedule()
            SessionState.Unlocked -> {
                if (session.canLock()) scheduler.schedule() else scheduler.cancel()
                pull(fullRefresh = needsFullRefresh)
            }
            SessionState.SignedOut -> {
                scheduler.cancel()
                needsFullRefresh = false
                lastPullAt = null
                _last.value = null
                // Only a session that was open ends here (not the first look at a signed-out app). An expired
                // session keeps the mirror (ADR 0043); a sign-out or a lost key deletes it.
                if (before != null && before != SessionState.SignedOut && session.ended.value != SessionEnd.Expired) {
                    engine.wipe()
                    choice.clear()
                }
            }
        }
    }

    suspend fun foregroundPull() {
        val at = lastPullAt
        if (session.state.value != SessionState.Unlocked) return
        if (at != null && clock.nowMillis() - at < ForegroundGapMillis) return
        pull(fullRefresh = needsFullRefresh)
    }

    /** "Refresh everything". */
    suspend fun refreshEverything() = pull(fullRefresh = true)

    /** One run of the periodic job. [attempt] counts the retries WorkManager has already made. */
    suspend fun backgroundPull(attempt: Int): BackgroundOutcome {
        if (session.state.value == SessionState.SignedOut) {
            scheduler.cancel()
            return BackgroundOutcome.Stop
        }
        return when (pull(fullRefresh = false)) {
            is PullResult.Updated -> BackgroundOutcome.Done
            PullResult.SignedOut -> BackgroundOutcome.Stop
            PullResult.Offline, PullResult.Failed, PullResult.NotFound ->
                if (attempt < MaxBackgroundRetries) BackgroundOutcome.Retry else BackgroundOutcome.Done
        }
    }

    private suspend fun pull(fullRefresh: Boolean): PullResult {
        val result = runner.run(fullRefresh)
        _last.value = result
        when (result) {
            is PullResult.Updated -> {
                lastPullAt = clock.nowMillis()
                if (fullRefresh || result.fullRefresh) needsFullRefresh = false
            }
            PullResult.SignedOut -> session.tokenRejected()
            else -> Unit
        }
        return result
    }

    companion object {
        const val ForegroundGapMillis = 30_000L
        const val MaxBackgroundRetries = 3
    }
}
