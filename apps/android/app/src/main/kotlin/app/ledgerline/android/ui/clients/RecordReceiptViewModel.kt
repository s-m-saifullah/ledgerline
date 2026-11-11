package app.ledgerline.android.ui.clients

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.mirror.AccountBalance
import app.ledgerline.android.mirror.MirrorReads
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.ReceiptWrites
import app.ledgerline.android.online.WriteError
import app.ledgerline.android.online.WriteKeys
import app.ledgerline.android.online.Written
import app.ledgerline.android.online.isStale
import app.ledgerline.android.online.toWriteError
import app.ledgerline.android.settings.PaymentChoices
import app.ledgerline.android.settings.PaymentChoicesStore
import app.ledgerline.android.sync.SyncCoordinator
import app.ledgerline.android.ui.design.Choice
import app.ledgerline.android.ui.editor.categoryChoices
import app.ledgerline.api.Contact
import app.ledgerline.api.ReceiptPreview
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate
import javax.inject.Inject

/**
 * The Record payment sheet for a client as the screen sees it: the form, what it can choose from, the services the amount
 * would pay (null while there is no valid amount to ask about), the problems found when Save was pressed, whether a write
 * is in flight, how the last one ended and whether the confirmation question is showing.
 */
data class ReceiptUi(
    val form: ReceiptForm,
    /** Open accounts in the chosen currency; other currencies come with the next slice. */
    val accounts: List<Choice>,
    val categories: List<Choice>,
    /** Some open account is in another currency than the chosen one, so the sheet says those wait for the next slice. */
    val otherCurrencyAccounts: Boolean,
    val noIncomeCategory: Boolean,
    val preview: Online<ReceiptPreview>? = null,
    val errors: Set<ReceiptProblem> = emptySet(),
    val saving: Boolean = false,
    val error: WriteError? = null,
    val asking: Boolean = false,
) {
    /** The currencies the client owes in; the sheet shows a currency row only when there are several. */
    val currencies: List<String> get() = form.target.owed.map { it.currency }
}

/**
 * Receiving a payment from a client (ADR 0050, slice 4c). Each change to the amount or currency reads which services it
 * would pay (the newest answer wins). Save checks the form and the preview and asks the confirmation question; nothing is
 * sent until it is answered, and the write names the services of the preview that matches the amount, so a service that
 * changed meanwhile is refused with `409`. The write is one idempotent call with a key per change. A payment that went
 * through closes the sheet, remembers the choices and tells the screen to read the client again; a stale answer shows the
 * server's sentence, does the same and reads the preview again.
 */
@HiltViewModel
class RecordReceiptViewModel @Inject constructor(
    private val reads: MirrorReads,
    private val writes: ReceiptWrites,
    private val sync: SyncCoordinator,
    private val store: PaymentChoicesStore,
) : ViewModel() {
    /** Today's date as the form starts with it; a test sets it. */
    internal var today: () -> String = { LocalDate.now().toString() }

    /** How long the amount rests before the services it pays are read, so typing does not ask at every key. */
    internal var previewDelayMillis: Long = 250

    private val keys = WriteKeys("rcpt")
    private val _sheet = MutableStateFlow<ReceiptUi?>(null)
    private val _reread = MutableStateFlow(0)
    private var openAccounts: List<AccountBalance> = emptyList()
    private var ledgerId: String? = null
    private var previewJob: Job? = null

    /** The sheet while it is open (null otherwise). */
    val sheet: StateFlow<ReceiptUi?> = _sheet.asStateFlow()

    /** Goes up each time the client on screen should be read again: after a payment, and after a stale answer. */
    val reread: StateFlow<Int> = _reread.asStateFlow()

    /** Opens the sheet for [client], with what the last payment chose where it is still offered. Nothing to pay opens nothing. */
    fun open(client: Contact) {
        val owed = client.openBalances.filter { it.amount > 0 }
        if (owed.isEmpty()) return
        keys.clear()
        previewJob?.cancel()
        viewModelScope.launch {
            val ledger = reads.mirroredLedger().first() ?: return@launch
            ledgerId = ledger
            openAccounts = reads.accountBalancesNow(ledger, includeHidden = false).filter { it.archivedAt == null }
            val categories = categoryChoices(reads.liveCategories(ledger).first(), kind = "income", selectedId = null)
            val remembered = store.load()
            val start = ReceiptForm.forClient(ReceiptTarget(client.id, client.name, owed), today())
            val accounts = accountsIn(start.currency)
            fun String?.ifOffered(choices: List<Choice>) = takeIf { id -> choices.any { it.id == id } }
            _sheet.value = ReceiptUi(
                form = start.copy(
                    accountId = remembered.accountId.ifOffered(accounts),
                    categoryId = remembered.categoryId.ifOffered(categories),
                    tipCategoryId = remembered.tipCategoryId.ifOffered(categories),
                ),
                accounts = accounts,
                categories = categories,
                otherCurrencyAccounts = openAccounts.any { it.currency != start.currency },
                noIncomeCategory = categories.isEmpty(),
            )
        }
    }

    private fun accountsIn(currency: String) = openAccounts.filter { it.currency == currency }.map { Choice(it.id, it.name, it.currency) }

    /** A change made by the person; it clears the problems and the last error, withdraws a question being asked and reads the preview again if the amount moved. */
    fun edit(change: (ReceiptForm) -> ReceiptForm) {
        val ui = _sheet.value ?: return
        if (ui.saving) return
        val form = change(ui.form)
        _sheet.value = ui.copy(form = form, errors = emptySet(), error = null, asking = false)
        if (form.previewAmount != ui.form.previewAmount || form.currency != ui.form.currency) readPreview()
    }

    /** Pay full balance: the amount becomes everything they owe in the chosen currency. */
    fun payInFull() = edit { it.payInFull() }

    /** Another currency of a client who owes in several: nothing typed or chosen carries over except the date, time and note. */
    fun chooseCurrency(currency: String) {
        if (_sheet.value?.form?.currency == currency) return
        edit { it.copy(currency = currency, amount = "", accountId = null) }
        _sheet.update { ui -> ui?.copy(accounts = accountsIn(currency), otherCurrencyAccounts = openAccounts.any { it.currency != currency }) }
    }

    /** Reads the services the amount would pay, once the amount has rested; an older read that has not come back is dropped. */
    private fun readPreview() {
        previewJob?.cancel()
        val ui = _sheet.value ?: return
        val amount = ui.form.previewAmount
        val ledger = ledgerId
        if (amount == null || ledger == null) {
            _sheet.value = ui.copy(preview = null)
            return
        }
        _sheet.value = ui.copy(preview = Online.Loading)
        previewJob = viewModelScope.launch {
            // On its own dispatcher, so the rest is a real pause (a test's main dispatcher has virtual time).
            if (previewDelayMillis > 0) withContext(Dispatchers.Default) { delay(previewDelayMillis) }
            val answer = writes.preview(ledger, ui.form.target.contactId, amount, ui.form.currency)
            _sheet.update { it?.copy(preview = answer) }
        }
    }

    /** Save: shows what is wrong, or asks the confirmation question. Sends nothing. */
    fun save() {
        val ui = _sheet.value ?: return
        if (ui.saving) return
        val problems = ui.form.problems()
        val ready = (ui.preview as? Online.Ready)?.value
        when {
            problems.isNotEmpty() -> _sheet.value = ui.copy(errors = problems.toSet(), asking = false)
            !ui.form.matches(ready) -> {
                _sheet.value = ui.copy(errors = setOf(ReceiptProblem.PreviewNotReady), asking = false)
                // A read that failed is tried again; one still on its way is left to finish.
                if (ui.preview is Online.Offline || ui.preview is Online.Failed) readPreview()
            }
            else -> _sheet.value = ui.copy(errors = emptySet(), error = null, asking = true)
        }
    }

    fun dismissAsk() = _sheet.update { it?.copy(asking = false) }

    /** The question was answered yes: sends the payment, once. */
    fun confirm() {
        val ui = _sheet.value ?: return
        if (ui.saving || !ui.asking) return
        val request = ui.form.request((ui.preview as? Online.Ready)?.value) ?: return
        val key = keys.keyFor(request.toString())
        _sheet.value = ui.copy(saving = true, error = null, asking = false)
        viewModelScope.launch {
            val ledger = reads.mirroredLedger().first()
            val result = if (ledger == null) Written.Failed else writes.record(ledger, ui.form.target.contactId, key, request)
            if (result is Written.Done) {
                keys.clear()
                val before = store.load()
                store.save(
                    PaymentChoices(
                        accountId = ui.form.accountId,
                        categoryId = ui.form.categoryId,
                        tipCategoryId = if (request.tip != null) ui.form.tipCategoryId else before.tipCategoryId,
                    ),
                )
                _sheet.value = null
                _reread.update { it + 1 }
                sync.pullNow()
            } else {
                _sheet.update { it?.copy(saving = false, error = result.toWriteError()) }
                if (result.isStale()) {
                    _reread.update { it + 1 }
                    sync.pullNow()
                    readPreview()
                }
            }
        }
    }

    /** Closes the sheet and forgets its keys; not while a payment is being sent. */
    fun close() {
        if (_sheet.value?.saving == true) return
        keys.clear()
        previewJob?.cancel()
        _sheet.value = null
    }
}
