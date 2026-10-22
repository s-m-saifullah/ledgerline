package app.ledgerline.android.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.mirror.AccountBalance
import app.ledgerline.android.mirror.EntryLine
import app.ledgerline.android.mirror.MirrorReads
import app.ledgerline.android.mirror.PullResult
import app.ledgerline.android.server.ServerAddressStore
import app.ledgerline.android.session.ClientsProvider
import app.ledgerline.android.session.SessionEnd
import app.ledgerline.android.session.SessionManager
import app.ledgerline.android.sync.SyncCoordinator
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/** A list read from the mirror; [Waiting] until the first full refresh has filled it. */
sealed interface Mirrored<out T> {
    data object Waiting : Mirrored<Nothing>
    data class Ready<T>(val items: List<T>) : Mirrored<T>
}

/** The line under the title: when the mirror was last brought up to date, and how the latest pull went. */
data class SyncLine(val updatedAt: String?, val running: Boolean, val problem: SyncProblem?)

enum class SyncProblem { Offline, Failed }

fun syncProblem(result: PullResult?): SyncProblem? = when (result) {
    PullResult.Offline -> SyncProblem.Offline
    PullResult.Failed, PullResult.NotFound -> SyncProblem.Failed
    else -> null
}

/** The signed-in screens: read-only lists from the mirror (ADR 0043, slice 3), plus lock and sign out. */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class SignedInViewModel @Inject constructor(
    private val addressStore: ServerAddressStore,
    private val clients: ClientsProvider,
    private val session: SessionManager,
    private val sync: SyncCoordinator,
    reads: MirrorReads,
) : ViewModel() {
    private val ledger: Flow<String?> = reads.mirroredLedger()
    private val entryLimit = MutableStateFlow(PageOfEntries)

    val accounts: StateFlow<Mirrored<AccountBalance>> = ledger
        .flatMapLatest { id ->
            if (id == null) flowOf(Mirrored.Waiting) else reads.accountBalances(id, includeHidden = false).map { Mirrored.Ready(it) }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), Mirrored.Waiting)

    val entries: StateFlow<Mirrored<EntryLine>> = combine(ledger, entryLimit) { id, limit -> id to limit }
        .flatMapLatest { (id, limit) ->
            if (id == null) flowOf(Mirrored.Waiting) else reads.entryLines(id, limit).map { Mirrored.Ready(it) }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), Mirrored.Waiting)

    /** True when the list may have more entries than it shows. */
    val canShowMore: StateFlow<Boolean> = combine(entries, entryLimit) { list, limit ->
        list is Mirrored.Ready && list.items.size >= limit
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    val syncLine: StateFlow<SyncLine> = combine(
        ledger.flatMapLatest { id -> if (id == null) flowOf(null) else reads.cursorOf(id).map { it?.serverTime } },
        sync.running,
        sync.last,
    ) { updated, running, last -> SyncLine(updated, running, syncProblem(last)) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SyncLine(null, false, null))

    private val _signingOut = MutableStateFlow(false)
    val signingOut: StateFlow<Boolean> = _signingOut.asStateFlow()

    fun refresh() {
        viewModelScope.launch { sync.pullNow() }
    }

    fun refreshEverything() {
        viewModelScope.launch { sync.refreshEverything() }
    }

    fun showMoreEntries() {
        entryLimit.value += PageOfEntries
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

    companion object {
        const val PageOfEntries = 100
    }
}
