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
import app.ledgerline.api.Service
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The Delete service question as the screen sees it: which service, whether the delete is in flight, and how the last try ended. */
data class DeleteUi(
    val serviceId: String,
    val description: String,
    /** The version of the service the phone holds; the server refuses the delete if the service moved on. */
    val version: Int,
    val saving: Boolean = false,
    val error: WriteError? = null,
)

/**
 * Deleting a service (ADR 0050, slice 5b). The question comes first and nothing is sent until it is answered yes. The delete is
 * one idempotent call with a key, so a retry after a lost answer is safe. The server refuses while the service has payments
 * (they are deleted on the web), and the question then shows its sentence; a `409` or `404` also tells the screen to read the
 * client again, because what it shows is out of date. A deleted service closes the question and the screen reads again.
 */
@HiltViewModel
class DeleteServiceViewModel @Inject constructor(
    private val reads: MirrorReads,
    private val writes: ServiceWrites,
) : ViewModel() {
    private val keys = WriteKeys("svcdel")
    private val _question = MutableStateFlow<DeleteUi?>(null)
    private val _reread = MutableStateFlow(0)

    /** The question while it is showing (null otherwise). */
    val question: StateFlow<DeleteUi?> = _question.asStateFlow()

    /** Goes up each time the client on screen should be read again: after a delete, and after a stale answer. */
    val reread: StateFlow<Int> = _reread.asStateFlow()

    /** Asks whether to delete [service]. */
    fun ask(service: Service) {
        keys.clear()
        _question.value = DeleteUi(service.id, service.description, service.version)
    }

    /** The question was answered yes: sends the delete, once. */
    fun confirm() {
        val ask = _question.value ?: return
        if (ask.saving) return
        val key = keys.keyFor("${ask.serviceId}:${ask.version}")
        _question.value = ask.copy(saving = true, error = null)
        viewModelScope.launch {
            val ledger = reads.mirroredLedger().first()
            val result = if (ledger == null) Written.Failed else writes.delete(ledger, ask.serviceId, key, ask.version)
            if (result is Written.Done) {
                keys.clear()
                _question.value = null
                _reread.update { it + 1 }
            } else {
                _question.update { it?.copy(saving = false, error = result.toWriteError()) }
                if (result.isStale()) _reread.update { it + 1 }
            }
        }
    }

    /** The question was answered no (or the sentence was read): closes it and forgets the key; not while a delete is being sent. */
    fun dismiss() {
        if (_question.value?.saving == true) return
        keys.clear()
        _question.value = null
    }
}
