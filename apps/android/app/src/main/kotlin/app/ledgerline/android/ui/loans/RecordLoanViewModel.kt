package app.ledgerline.android.ui.loans

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.mirror.MirrorReads
import app.ledgerline.android.online.LoanWrites
import app.ledgerline.android.online.WriteError
import app.ledgerline.android.online.WriteKeys
import app.ledgerline.android.online.Written
import app.ledgerline.android.online.isStale
import app.ledgerline.android.online.toWriteError
import app.ledgerline.android.settings.PaymentChoicesStore
import app.ledgerline.android.sync.SyncCoordinator
import app.ledgerline.api.LoanBalance
import app.ledgerline.api.LoanResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.LocalDate
import javax.inject.Inject

/** The Lend, Borrow and Repay sheet as the screen sees it: the form, the problems found when Save was pressed, whether a write is in flight, how the last one ended and whether the question is showing. */
data class LoanUi(
    val form: LoanForm,
    val errors: Set<LoanProblem> = emptySet(),
    val saving: Boolean = false,
    val error: WriteError? = null,
    val asking: Boolean = false,
)

/**
 * Lending to a person, borrowing from them and repaying what is open (ADR 0050, slice 6). Save checks the form and asks the
 * confirmation question; nothing is sent until it is answered, because money moves between accounts. The write is one
 * idempotent call with a key per change, so a retry after a lost answer is safe. A move that went through closes the sheet,
 * remembers the account for next time and tells the screen to read the person again; a `409` or `404` (the loan changed
 * meanwhile, or nothing is owed) shows the server's sentence and does the same, because what the screen shows is out of date.
 */
@HiltViewModel
class RecordLoanViewModel @Inject constructor(
    private val reads: MirrorReads,
    private val writes: LoanWrites,
    private val sync: SyncCoordinator,
    private val store: PaymentChoicesStore,
) : ViewModel() {
    /** Today's date as the form starts with it; a test sets it. */
    internal var today: () -> String = { LocalDate.now().toString() }

    private val keys = WriteKeys("loan")
    private val _sheet = MutableStateFlow<LoanUi?>(null)
    private val _reread = MutableStateFlow(0)

    /** The sheet while it is open (null otherwise). */
    val sheet: StateFlow<LoanUi?> = _sheet.asStateFlow()

    /** Goes up each time the person on screen should be read again: after a move, and after a stale answer. */
    val reread: StateFlow<Int> = _reread.asStateFlow()

    /** Opens the sheet for [kind] with [who], whose loans are [loans]. A repayment needs something open, so nothing opens for one without. */
    fun open(who: LoanWho, loans: List<LoanBalance>, kind: LoanKind) {
        val open = loans.filter { it.balance.amount != 0L }.map { OpenLoan(it.currency, it.balance.amount) }
        if (kind == LoanKind.Repay && open.isEmpty()) return
        keys.clear()
        viewModelScope.launch {
            val ledger = reads.mirroredLedger().first() ?: return@launch
            val accounts = reads.accountBalancesNow(ledger, includeHidden = false)
                .filter { it.archivedAt == null }
                .map { LoanAccount(it.id, it.name, it.currency) }
            val form = LoanForm.start(who, kind, open, accounts, today())
            // The account of the last move, while it is still offered for this kind of move.
            val remembered = store.load().loanAccountId
            _sheet.value = LoanUi(form.copy(accountId = remembered?.takeIf { id -> form.usable.any { it.id == id } }))
        }
    }

    /** A change made by the person; it clears the problems and the last error and withdraws a question being asked. Ignored while a move is being sent. */
    fun edit(change: (LoanForm) -> LoanForm) {
        val before = _sheet.value ?: return
        if (before.saving) return
        _sheet.value = before.copy(form = change(before.form), errors = emptySet(), error = null, asking = false)
    }

    /** Save: shows what is wrong, or asks the confirmation question. Sends nothing. */
    fun save() {
        val ui = _sheet.value ?: return
        if (ui.saving) return
        val problems = ui.form.problems()
        _sheet.value = if (problems.isEmpty()) ui.copy(errors = emptySet(), error = null, asking = true) else ui.copy(errors = problems.toSet(), asking = false)
    }

    fun dismissAsk() = _sheet.update { it?.copy(asking = false) }

    /** The question was answered yes: sends the move, once. */
    fun confirm() {
        val ui = _sheet.value ?: return
        if (ui.saving || !ui.asking) return
        val form = ui.form
        val request = form.request() ?: return
        val key = keys.keyFor("${form.kind}:${form.who.id}:$request")
        _sheet.value = ui.copy(saving = true, error = null, asking = false)
        viewModelScope.launch {
            val ledger = reads.mirroredLedger().first()
            val result: Written<LoanResult> = when {
                ledger == null -> Written.Failed
                form.kind == LoanKind.Lend -> writes.lend(ledger, form.who.id, key, request)
                form.kind == LoanKind.Borrow -> writes.borrow(ledger, form.who.id, key, request)
                else -> writes.repay(ledger, form.who.id, key, request)
            }
            if (result is Written.Done) {
                keys.clear()
                store.save(store.load().copy(loanAccountId = request.accountId))
                _sheet.value = null
                _reread.update { it + 1 }
                sync.pullNow()
            } else {
                _sheet.update { it?.copy(saving = false, error = result.toWriteError()) }
                if (result.isStale()) {
                    _reread.update { it + 1 }
                    sync.pullNow()
                }
            }
        }
    }

    /** Closes the sheet and forgets its keys; not while a move is being sent. */
    fun close() {
        if (_sheet.value?.saving == true) return
        keys.clear()
        _sheet.value = null
    }
}
