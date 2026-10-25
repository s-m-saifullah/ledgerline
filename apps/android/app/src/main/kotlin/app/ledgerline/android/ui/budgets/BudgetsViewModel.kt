package app.ledgerline.android.ui.budgets

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.mirror.MirrorReads
import app.ledgerline.android.online.BudgetWrites
import app.ledgerline.android.online.MonthlyRead
import app.ledgerline.android.online.Written
import app.ledgerline.android.outbox.Uuid7
import app.ledgerline.android.ui.editor.amountText
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.OnlineReader
import app.ledgerline.api.BudgetLine
import app.ledgerline.api.BudgetMonth
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.YearMonth
import javax.inject.Inject

/**
 * A month of budgets, read online from `GET /budgets` (ADR 0043, slice 5) while the screen shows it; see
 * [MonthlyRead] for when it reads.
 */
@HiltViewModel
class BudgetsViewModel @Inject constructor(
    reader: OnlineReader,
    private val reads: MirrorReads,
    private val writes: BudgetWrites,
) : ViewModel() {
    private val read = MonthlyRead<BudgetMonth>(viewModelScope, reads, { it.month }) { ledger, month ->
        reader.read { budgets(ledger, month) }
    }
    val month: StateFlow<YearMonth> = read.month
    val budgets: StateFlow<Online<BudgetMonth>> = read.state

    fun previous() = read.previous()

    fun next() = read.next()

    fun retry() = read.retry()

    private val _limit = MutableStateFlow<LimitUi?>(null)
    private val keys = mutableMapOf<String, String>()

    /** The Set limit sheet while it is open (null otherwise). */
    val limit: StateFlow<LimitUi?> = _limit

    /** Opens the sheet for [line] in the month on screen; an archived category has none. */
    fun openLimit(line: BudgetLine) {
        val form = LimitForm.forLine(line, month.value.toString()) ?: return
        keys.clear()
        _limit.value = LimitUi(form)
    }

    fun editLimit(text: String) = _limit.update { ui -> ui?.copy(form = ui.form.copy(text = text), error = null) }

    fun pickPreset(minor: Long) = _limit.value?.let { editLimit(amountText(minor, it.form.target.currency)) } ?: Unit

    fun closeLimit() {
        if (_limit.value?.saving == true) return
        keys.clear()
        _limit.value = null
    }

    fun askRemove() = _limit.update { ui -> ui?.takeIf { it.form.editing && !it.saving }?.copy(askRemove = true, error = null) ?: ui }

    fun dismissRemove() = _limit.update { ui -> ui?.copy(askRemove = false) }

    /** Sets the limit: a new one, or an edit that carries the version the phone holds. */
    fun saveLimit() {
        val ui = _limit.value ?: return
        val request = ui.form.request() ?: return
        if (ui.saving || !ui.form.canSave) return
        val key = keyFor("set|${request.categoryId}|${request.month}|${request.amount.amount}|${request.expectedVersion}")
        send { ledger -> writes.set(ledger, key, request) }
    }

    /** Removes the limit the sheet is open for, once the question has been answered. */
    fun confirmRemove() {
        val ui = _limit.value ?: return
        val budget = ui.form.target.budget ?: return
        if (ui.saving || !ui.askRemove) return
        val key = keyFor("remove|${budget.id}|${budget.version}")
        send { ledger -> writes.remove(ledger, budget.id, key, budget.version) }
    }

    private fun keyFor(change: String) = keys.getOrPut(change) { "bud-${Uuid7.next()}" }

    private fun send(call: suspend (String) -> Written<*>) {
        _limit.update { it?.copy(saving = true, error = null, askRemove = false) }
        viewModelScope.launch {
            val ledger = reads.mirroredLedger().first()
            val result = if (ledger == null) Written.Failed else call(ledger)
            if (result is Written.Done) {
                keys.clear()
                _limit.value = null
                read.retry()
            } else {
                _limit.update { it?.copy(saving = false, error = result.toLimitError()) }
                // A version that moved on or a budget already gone: show what the server says and read the month again.
                if (result is Written.Rejected && (result.status == 409 || result.status == 404)) read.retry()
            }
        }
    }
}
