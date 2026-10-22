package app.ledgerline.android.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.mirror.AccountBalance
import app.ledgerline.android.mirror.MirrorReads
import app.ledgerline.android.outbox.OutboxStore
import app.ledgerline.android.overlay.AttentionItem
import app.ledgerline.android.overlay.LedgerView
import app.ledgerline.android.overlay.ShownLine
import app.ledgerline.android.overlay.attentionItem
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
    private val view: LedgerView,
    private val outbox: OutboxStore,
    reads: MirrorReads,
) : ViewModel() {
    private val ledger: Flow<String?> = reads.mirroredLedger()
    private val entryLimit = MutableStateFlow(PageOfEntries)

    val accounts: StateFlow<Mirrored<AccountBalance>> = ledger
        .flatMapLatest { id ->
            if (id == null) flowOf(Mirrored.Waiting) else view.accounts(id).map { Mirrored.Ready(it) }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), Mirrored.Waiting)

    val entries: StateFlow<Mirrored<ShownLine>> = combine(ledger, entryLimit) { id, limit -> id to limit }
        .flatMapLatest { (id, limit) ->
            if (id == null) flowOf(Mirrored.Waiting) else view.entries(id, limit).map { Mirrored.Ready(it) }
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

    /** Changes waiting to be sent. */
    val unsent: StateFlow<Int> = outbox.unsent.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)

    /** Changes the server did not take, for the owner to decide. */
    val attention: StateFlow<List<AttentionItem>> = outbox.attention
        .map { rows -> rows.map(::attentionItem) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _signingOut = MutableStateFlow(false)
    val signingOut: StateFlow<Boolean> = _signingOut.asStateFlow()

    /** Set while sign-out waits for the owner to decide about changes the server does not have. */
    private val _confirmSignOut = MutableStateFlow<Int?>(null)
    val confirmSignOut: StateFlow<Int?> = _confirmSignOut.asStateFlow()

    fun keepMine(id: String) {
        viewModelScope.launch {
            if (outbox.keepMine(id)) sync.changed()
        }
    }

    fun keepTheirs(id: String) {
        viewModelScope.launch { outbox.keepTheirs(id) }
    }

    fun discard(id: String) {
        viewModelScope.launch { outbox.discard(id) }
    }

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

    /** Sign out; first asks when changes made on the phone are not on the server yet. */
    fun signOut() {
        viewModelScope.launch {
            val waiting = outbox.notOnServerCount()
            if (waiting > 0) _confirmSignOut.value = waiting else endSession()
        }
    }

    fun cancelSignOut() {
        _confirmSignOut.value = null
    }

    /** Send now from the sign-out question: try to send, then ask again only if something is still waiting. */
    fun sendBeforeSigningOut() {
        _confirmSignOut.value = null
        viewModelScope.launch { sync.pullNow() }
    }

    /** The owner confirmed: delete the changes the server does not have, then sign out. */
    fun signOutDeletingUnsent() {
        _confirmSignOut.value = null
        viewModelScope.launch {
            outbox.clearAll()
            endSession()
        }
    }

    private fun endSession() {
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
