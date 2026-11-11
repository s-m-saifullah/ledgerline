package app.ledgerline.android.ui.clients

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.mirror.MirrorReads
import app.ledgerline.android.online.PaymentWrites
import app.ledgerline.android.online.RateReads
import app.ledgerline.android.online.WriteError
import app.ledgerline.android.online.WriteKeys
import app.ledgerline.android.online.Written
import app.ledgerline.android.online.isStale
import app.ledgerline.android.online.toWriteError
import app.ledgerline.android.settings.PaymentChoicesStore
import app.ledgerline.android.sync.SyncCoordinator
import app.ledgerline.android.ui.design.Choice
import app.ledgerline.android.ui.editor.categoryChoices
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

/**
 * The Record payment sheet as the screen sees it: the form, what it can choose from, the problems found when Save was
 * pressed, whether a write is in flight, how the last one ended and whether the confirmation question is showing.
 */
data class PaymentUi(
    val form: PaymentForm,
    /** Open accounts the payment can go into, in any currency (an account balance kept for a client is not one). */
    val accounts: List<Choice>,
    val categories: List<Choice>,
    /** There is no income category to choose, so a payment cannot be recorded yet. */
    val noIncomeCategory: Boolean,
    val errors: Set<PaymentProblem> = emptySet(),
    val saving: Boolean = false,
    val error: WriteError? = null,
    val asking: Boolean = false,
)

/**
 * Receiving a payment for one service (ADR 0050, slices 4a to 4b-2). Save checks the form and asks the confirmation
 * question; nothing is sent until it is answered. An account where neither side is the base currency reads the rate the
 * ledger stores for the account's currency on the payment's date, again when the account or the date changes; a date or
 * account with no rate stored blocks Save until one is typed, and a look-up that failed does not (the server decides). The write is one idempotent call with a key per change, so a retry after a lost
 * answer is safe. A payment that went through closes the sheet, remembers the account and categories for next time and
 * tells the screen to read the client again; a `409` or `404` (the service changed meanwhile) shows the server's sentence
 * and does the same, because what the screen shows is out of date.
 */
@HiltViewModel
class RecordPaymentViewModel @Inject constructor(
    private val reads: MirrorReads,
    private val writes: PaymentWrites,
    private val sync: SyncCoordinator,
    private val store: PaymentChoicesStore,
    rates: RateReads,
) : ViewModel() {
    /** Today's date as the form starts with it; a test sets it. */
    internal var today: () -> String = { LocalDate.now().toString() }

    private val keys = WriteKeys("pay")
    private val _sheet = MutableStateFlow<PaymentUi?>(null)
    private val _reread = MutableStateFlow(0)
    private val follower = RateFollower(viewModelScope, rates)
    private var ledgerId: String? = null

    /** The sheet while it is open (null otherwise). */
    val sheet: StateFlow<PaymentUi?> = _sheet.asStateFlow()

    /** Goes up each time the client on screen should be read again: after a payment, and after a stale answer. */
    val reread: StateFlow<Int> = _reread.asStateFlow()

    /** Opens the sheet for [service] of [clientName], with what the last payment chose where it is still offered. */
    fun open(service: Service, clientName: String) {
        keys.clear()
        follower.stop()
        viewModelScope.launch {
            val ledger = reads.mirroredLedger().first() ?: return@launch
            ledgerId = ledger
            val target = PaymentTarget(
                serviceId = service.id,
                serviceVersion = service.version,
                description = service.description,
                clientName = clientName,
                currency = service.outstanding.currency,
                outstanding = service.outstanding.amount,
            )
            val open = reads.accountBalancesNow(ledger, includeHidden = false).filter { it.archivedAt == null }
            val accounts = open.map { Choice(it.id, it.name, it.currency) }
            val categories = categoryChoices(reads.liveCategories(ledger).first(), kind = "income", selectedId = null)
            val remembered = store.load()
            fun String?.ifOffered(choices: List<Choice>) = takeIf { id -> choices.any { it.id == id } }
            val form = PaymentForm.forService(target, today()).copy(
                accountId = remembered.accountId.ifOffered(accounts),
                accountCurrency = accounts.find { it.id == remembered.accountId }?.currency,
                categoryId = remembered.categoryId.ifOffered(categories),
                tipCategoryId = remembered.tipCategoryId.ifOffered(categories),
            )
            _sheet.value = PaymentUi(
                form = form,
                accounts = accounts,
                categories = categories,
                noIncomeCategory = categories.isEmpty(),
            )
            followRate(form.rateKey)
        }
    }

    /** A change made by the person; it clears the problems and the last error, withdraws a question being asked and reads the rate again if the account or date moved. */
    fun edit(change: (PaymentForm) -> PaymentForm) {
        val before = _sheet.value ?: return
        if (before.saving) return
        val form = change(before.form)
        _sheet.value = before.copy(form = form, errors = emptySet(), error = null, asking = false)
        if (form.rateKey != before.form.rateKey) followRate(form.rateKey)
    }

    private fun followRate(key: RateKey?) = follower.follow(ledgerId, key) { answer ->
        _sheet.update { ui ->
            if (ui == null || ui.form.rateKey != answer.key) return@update ui
            val form = ui.form.copy(rateAnswer = answer)
            // A question already being asked is withdrawn when this answer means the payment cannot be saved.
            ui.copy(form = form, asking = ui.asking && form.problems().isEmpty())
        }
    }

    /** Save: shows what is wrong, or asks the confirmation question. Sends nothing. */
    fun save() {
        val ui = _sheet.value ?: return
        if (ui.saving) return
        val problems = ui.form.problems()
        // A rate that could not be looked up is tried again; the question still goes ahead, the server decides.
        if (ui.form.cross?.stored == StoredRate.Unavailable && ui.form.cross?.manualRate == null) followRate(ui.form.rateKey)
        _sheet.value = if (problems.isEmpty()) ui.copy(errors = emptySet(), error = null, asking = true) else ui.copy(errors = problems.toSet(), asking = false)
    }

    fun dismissAsk() = _sheet.update { it?.copy(asking = false) }

    /** The question was answered yes: sends the payment, once. */
    fun confirm() {
        val ui = _sheet.value ?: return
        if (ui.saving || !ui.asking) return
        val request = ui.form.request() ?: return
        val key = keys.keyFor(request.toString())
        _sheet.value = ui.copy(saving = true, error = null, asking = false)
        viewModelScope.launch {
            val ledger = reads.mirroredLedger().first()
            val result = if (ledger == null) Written.Failed else writes.record(ledger, ui.form.target.serviceId, key, request)
            if (result is Written.Done) {
                keys.clear()
                val before = store.load()
                store.save(
                    before.copy(
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
                }
            }
        }
    }

    /** Closes the sheet and forgets its keys; not while a payment is being sent. */
    fun close() {
        if (_sheet.value?.saving == true) return
        keys.clear()
        follower.stop()
        _sheet.value = null
    }
}
