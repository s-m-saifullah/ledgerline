package app.ledgerline.android.ui.clients

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.mirror.MirrorReads
import app.ledgerline.android.online.ServiceWrites
import app.ledgerline.android.online.WriteError
import app.ledgerline.android.online.WriteKeys
import app.ledgerline.android.online.Written
import app.ledgerline.android.online.isStale
import app.ledgerline.android.online.toWriteError
import app.ledgerline.api.Contact
import app.ledgerline.api.Service
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.LocalDate
import javax.inject.Inject

/** The Log service sheet as the screen sees it: the form, the currencies it can choose from, the problems found when Save was pressed, whether a write is in flight and how the last one ended. */
data class LogServiceUi(
    val form: ServiceForm,
    /** The base currency first, then the ones the ledger added; the Currency row shows only when there is more than one. */
    val currencies: List<String>,
    val errors: Set<ServiceProblem> = emptySet(),
    val saving: Boolean = false,
    val error: WriteError? = null,
)

/**
 * Logging a service for a client, and editing one (ADR 0050, slices 5 and 5b). Nothing is sent until Save, and Save asks no
 * question because no money moves. The write is one idempotent call with a key per change, so a retry after a lost answer is
 * safe. A saved service closes the sheet and tells the screen to read the client again; a `409` or `404` (the client or the
 * service changed or is gone) shows the server's sentence and does the same, because what the screen shows is out of date.
 * The sheet then stays, but an edit still holds the old version, so it has to be closed and opened again.
 */
@HiltViewModel
class LogServiceViewModel @Inject constructor(
    private val reads: MirrorReads,
    private val writes: ServiceWrites,
) : ViewModel() {
    /** Today's date as the form starts with it; a test sets it. */
    internal var today: () -> String = { LocalDate.now().toString() }

    private val keys = WriteKeys("svc")
    private val _sheet = MutableStateFlow<LogServiceUi?>(null)
    private val _reread = MutableStateFlow(0)

    /** The sheet while it is open (null otherwise). */
    val sheet: StateFlow<LogServiceUi?> = _sheet.asStateFlow()

    /** Goes up each time the client on screen should be read again: after a service was saved, and after a stale answer. */
    val reread: StateFlow<Int> = _reread.asStateFlow()

    /** Opens the sheet for [client]. An archived client takes no new service (as on the web), so nothing opens. */
    fun open(client: Contact) {
        if (client.archivedAt != null) return
        show { ServiceForm.forClient(ServiceClient(client.id, client.name), today()) }
    }

    /**
     * Opens the sheet to edit [service] of [client], filled in as the phone holds it. A written-off service has to be reopened
     * first (the server says so), so nothing opens for one; the screen does not offer it either.
     */
    fun openEdit(client: Contact, service: Service) {
        if (service.status == "writtenOff") return
        show { ServiceForm.forEditing(ServiceClient(client.id, client.name), service) }
    }

    private fun show(form: () -> ServiceForm) {
        keys.clear()
        viewModelScope.launch {
            val ledger = reads.mirroredLedger().first() ?: return@launch
            val added = reads.liveCurrencyCodes(ledger)
            _sheet.value = LogServiceUi(form(), currencies = listOf(BaseCurrency) + added.filter { it != BaseCurrency })
        }
    }

    /** A change made by the person; it clears the problems and the last error. Ignored while a service is being sent. */
    fun edit(change: (ServiceForm) -> ServiceForm) {
        val before = _sheet.value ?: return
        if (before.saving) return
        _sheet.value = before.copy(form = change(before.form), errors = emptySet(), error = null)
    }

    /** Save: shows what is wrong, or sends the service (a new one, or the edit of an existing one), once. */
    fun save() {
        val ui = _sheet.value ?: return
        if (ui.saving) return
        val form = ui.form
        val edit = form.editing
        // A form with a problem has no request: the problems are shown instead.
        val create = if (edit == null) form.request() else null
        val update = if (edit != null) form.updateRequest() else null
        val request: Any = create ?: update ?: run {
            _sheet.value = ui.copy(errors = form.problems().toSet())
            return
        }
        val key = keys.keyFor(request.toString())
        _sheet.value = ui.copy(errors = emptySet(), saving = true, error = null)
        viewModelScope.launch {
            val ledger = reads.mirroredLedger().first()
            val result: Written<Service> = when {
                ledger == null -> Written.Failed
                create != null -> writes.log(ledger, key, create)
                else -> writes.update(ledger, edit!!.serviceId, key, update!!)
            }
            if (result is Written.Done) {
                keys.clear()
                _sheet.value = null
                _reread.update { it + 1 }
            } else {
                _sheet.update { it?.copy(saving = false, error = result.toWriteError()) }
                if (result.isStale()) _reread.update { it + 1 }
            }
        }
    }

    /** Closes the sheet and forgets its keys; not while a service is being sent. */
    fun close() {
        if (_sheet.value?.saving == true) return
        keys.clear()
        _sheet.value = null
    }
}
