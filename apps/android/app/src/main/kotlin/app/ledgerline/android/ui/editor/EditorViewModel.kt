package app.ledgerline.android.ui.editor

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.mirror.AccountRow
import app.ledgerline.android.mirror.CategoryRow
import app.ledgerline.android.mirror.MirrorDao
import app.ledgerline.android.mirror.MirrorReads
import app.ledgerline.android.outbox.OutboxRow
import app.ledgerline.android.outbox.OutboxStore
import app.ledgerline.android.outbox.WallClock
import app.ledgerline.android.overlay.LedgerView
import app.ledgerline.android.overlay.Overlay
import app.ledgerline.android.overlay.ShownEntry
import app.ledgerline.android.sync.SyncCoordinator
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.time.ZoneId
import javax.inject.Inject

/**
 * Adding, editing and deleting an entry or a transfer on the phone (ADR 0043, slice 4). Saving only writes the outbox
 * and asks the sync to send; it works the same with or without a connection. Split entries, client payments, fee and
 * bonus entries and transfers with a fee, bonus or two currencies are shown read-only (edited on the web).
 */
@HiltViewModel
class EditorViewModel @Inject constructor(
    private val reads: MirrorReads,
    private val dao: MirrorDao,
    private val view: LedgerView,
    private val outbox: OutboxStore,
    private val sync: SyncCoordinator,
    private val memory: FormMemory,
    private val clock: WallClock,
) : ViewModel() {
    private val _state = MutableStateFlow<EditorState?>(null)

    /** Null while loading. */
    val state: StateFlow<EditorState?> = _state.asStateFlow()

    private var session: String? = null
    private var loading: Job? = null
    private var ledgerId = ""
    private lateinit var target: EditorTarget
    private var accounts: List<AccountRow> = emptyList()
    private var categories: List<CategoryRow> = emptyList()

    /** The entry (or the transfer's outgoing and incoming legs) as it stands with every pending change. */
    private var current: ShownEntry? = null
    private var currentTo: ShownEntry? = null
    private var fixRow: OutboxRow? = null

    /**
     * Opens the editor for [target]. The view model outlives one opening (it belongs to the activity), so each
     * opening has its own [session]: a new one starts from scratch, and the same one (a rotation) keeps the form.
     */
    fun open(target: EditorTarget, session: String) {
        if (session == this.session) return
        this.session = session
        loading?.cancel()
        _state.value = null
        current = null
        currentTo = null
        fixRow = null
        this.target = target
        loading = viewModelScope.launch { _state.value = load(target).copy(session = session) }
    }

    /** Applies a finished save or delete only if the owner is still in the same opening of the editor. */
    private fun finish(state: EditorState) {
        if (state.session == session) _state.value = state
    }

    private suspend fun load(target: EditorTarget): EditorState {
        val ledger = reads.mirroredLedger().first() ?: return gone()
        ledgerId = ledger
        accounts = dao.allAccounts(ledger).filter { it.deletedAt == null }
        categories = dao.allCategories(ledger).filter { it.deletedAt == null }
        val tags = dao.allTags(ledger).filter { it.deletedAt == null }
        val today = clock.now().atZone(ZoneId.systemDefault()).toLocalDate().toString()
        val tagChoices = { chosen: List<String> ->
            tags.filter { it.archivedAt == null || it.id in chosen }.sortedBy { it.name.lowercase() }.map { Choice(it.id, it.name, archived = it.archivedAt != null) }
        }
        return when (target) {
            is EditorTarget.New -> {
                val kind = target.mode.kind()
                val account = memory.account()?.takeIf { id -> accounts.any { it.id == id && it.usable() } }
                    ?: accounts.filter { it.usable() }.minByOrNull { it.name.lowercase() }?.id
                val category = memory.category(kind)?.takeIf { id -> categories.any { it.id == id && it.kind == kind && it.archivedAt == null } }
                val form = EditorForm(target.mode, "", account, null, category, today, "", "", emptyList())
                stateFor(form, isNew = true, tags = tagChoices(emptyList()))
            }
            is EditorTarget.Entry -> {
                val entry = view.current(ledger, entryIds = listOf(target.id))[target.id] ?: return gone()
                if (entry.kind == "transfer" && entry.transferId != null) return load(EditorTarget.Transfer(entry.transferId).also { this.target = it })
                current = entry
                stateFor(entryForm(entry), isNew = false, tags = tagChoices(entry.tagIds), readOnly = entryReadOnly(entry), canDelete = true)
            }
            is EditorTarget.Transfer -> {
                val legs = view.current(ledger, transferIds = listOf(target.transferId)).values.filterNotNull()
                    .filter { it.transferId == target.transferId && it.kind == "transfer" }
                val from = legs.find { it.amount < 0 } ?: return gone()
                val to = legs.find { it.amount > 0 } ?: return gone()
                current = from
                currentTo = to
                stateFor(transferForm(from, to), isNew = false, tags = emptyList(), readOnly = transferReadOnly(from, to), canDelete = true)
            }
            is EditorTarget.Fix -> {
                val row = outbox.find(target.outboxId)?.takeIf { it.state == OutboxRow.Rejected && it.action != "delete" } ?: return gone()
                fixRow = row
                val pendingAgain = row.copy(state = OutboxRow.Pending)
                if (row.kind == "transaction") {
                    val base = if (row.action == "create") null else view.current(ledger, entryIds = listOf(row.entityId))[row.entityId] ?: return gone()
                    current = base
                    val fixed = Overlay.apply(listOfNotNull(base), listOf(pendingAgain))[row.entityId] ?: return gone()
                    stateFor(entryForm(fixed), isNew = row.action == "create", tags = tagChoices(fixed.tagIds))
                } else {
                    val base = if (row.action == "create") {
                        emptyList()
                    } else {
                        view.current(ledger, transferIds = listOf(row.entityId)).values.filterNotNull().filter { it.transferId == row.entityId }
                    }
                    current = base.find { it.amount < 0 }
                    currentTo = base.find { it.amount > 0 }
                    val fixed = Overlay.apply(base, listOf(pendingAgain)).values.filterNotNull().filter { it.transferId == row.entityId }
                    val from = fixed.find { it.amount < 0 } ?: return gone()
                    val to = fixed.find { it.amount > 0 } ?: return gone()
                    stateFor(transferForm(from, to), isNew = row.action == "create", tags = emptyList())
                }
            }
        }
    }

    fun update(change: (EditorForm) -> EditorForm) {
        val now = _state.value ?: return
        if (now.readOnly != null || now.saving) return
        val before = now.form
        var form = change(before)
        if (form.mode != before.mode) {
            // A category belongs to one kind; a transfer has no category and needs a second account.
            form = form.copy(
                categoryId = if (form.mode == EntryMode.Transfer) null else memory.category(form.mode.kind())
                    ?.takeIf { id -> categories.any { it.id == id && it.kind == form.mode.kind() && it.archivedAt == null } },
                toAccountId = null,
            )
        }
        if (form.accountId != before.accountId && form.toAccountId == form.accountId) form = form.copy(toAccountId = null)
        _state.value = stateFor(form, now.isNew, now.tags, now.readOnly, now.canDelete).copy(errors = emptySet(), session = now.session)
    }

    fun save() {
        val now = _state.value ?: return
        if (now.readOnly != null || now.saving) return
        val form = now.form
        val account = accounts.find { it.id == form.accountId }
        val errors = mutableSetOf<FormError>()
        if (account == null) errors += FormError.AccountMissing
        val currency = current?.currency?.takeIf { !now.isNew && target !is EditorTarget.Fix } ?: account?.currency ?: "USD"
        val minor = when (val parsed = parseAmount(form.amount, currency)) {
            is AmountInput.Valid -> parsed.minor
            AmountInput.Missing -> null.also { errors += FormError.AmountMissing }
            AmountInput.Invalid -> null.also { errors += FormError.AmountInvalid }
            AmountInput.TooPrecise -> null.also { errors += FormError.AmountTooPrecise }
            AmountInput.Zero -> null.also { errors += FormError.AmountZero }
            AmountInput.TooLarge -> null.also { errors += FormError.AmountTooLarge }
        }
        // As on the web, an expense or income needs a category.
        if (form.mode != EntryMode.Transfer && form.categoryId == null) errors += FormError.CategoryMissing
        if (form.mode == EntryMode.Transfer) {
            if (form.toAccountId == null) errors += FormError.ToAccountMissing
            if (form.toAccountId != null && form.toAccountId == form.accountId) errors += FormError.SameAccount
        }
        if (errors.isNotEmpty() || minor == null || account == null) {
            _state.value = now.copy(errors = errors)
            return
        }
        _state.value = now.copy(saving = true, errors = emptySet())
        viewModelScope.launch {
            val saved = runCatching { write(form, account, currency, minor) }
            finish(if (saved.isSuccess) {
                memory.remember(account.id, form.mode.kind(), form.categoryId)
                sync.changed()
                now.copy(saving = false, done = true)
            } else {
                now.copy(saving = false, errors = setOf(FormError.CouldNotSave))
            })
        }
    }

    fun delete() {
        val now = _state.value ?: return
        if (!now.canDelete || now.readOnly != null || now.saving) return
        _state.value = now.copy(saving = true)
        viewModelScope.launch {
            val deleted = runCatching {
                when (val t = target) {
                    is EditorTarget.Entry -> outbox.deleteEntry(ledgerId, t.id)
                    is EditorTarget.Transfer -> outbox.deleteTransfer(ledgerId, t.transferId)
                    else -> error("Only a saved entry or transfer can be deleted.")
                }
            }
            if (deleted.isSuccess) sync.changed()
            finish(now.copy(saving = false, done = deleted.isSuccess, errors = if (deleted.isSuccess) emptySet() else setOf(FormError.CouldNotSave)))
        }
    }

    private suspend fun write(form: EditorForm, account: AccountRow, currency: String, minor: Long) {
        val fix = fixRow
        if (fix != null) outbox.discard(fix.id)
        val isTransfer = form.mode == EntryMode.Transfer
        val creating = target is EditorTarget.New || fix?.action == "create"
        val payee = form.payee.trim().ifEmpty { null }
        val note = form.note.trim().ifEmpty { null }
        if (isTransfer) {
            val values = TransferValues(account.id, form.toAccountId!!, minor, currency, form.date, form.time, note)
            if (creating) {
                outbox.createTransfer(ledgerId, transferBody(values))
            } else {
                val transferId = (target as? EditorTarget.Transfer)?.transferId ?: fix!!.entityId
                val before = current?.let { from -> currentTo?.let { to -> transferValues(from, to) } }
                if (values != before) outbox.updateTransfer(ledgerId, transferId, transferBody(values))
            }
            return
        }
        val kind = form.mode.kind()
        val values = EntryValues(kind, account.id, form.categoryId, form.date, if (kind == "expense") -minor else minor, currency, payee, note, form.tagIds, form.time)
        if (creating) {
            outbox.createEntry(ledgerId, entryCreateBody(values))
        } else {
            val entryId = (target as? EditorTarget.Entry)?.id ?: fix!!.entityId
            val changes = entryChanges(current!!, values)
            if (changes.isNotEmpty()) outbox.updateEntry(ledgerId, entryId, changes)
        }
    }

    private fun stateFor(
        form: EditorForm,
        isNew: Boolean,
        tags: List<Choice>,
        readOnly: ReadOnly? = null,
        canDelete: Boolean = false,
    ): EditorState {
        val editingEntry = !isNew && form.mode != EntryMode.Transfer
        val keepCurrency = current?.currency?.takeIf { !isNew }
        val accountChoices = accounts
            .filter { (it.usable() || it.id == form.accountId) && (keepCurrency == null || it.currency == keepCurrency) }
            .sortedBy { it.name.lowercase() }
            .map { Choice(it.id, it.name, it.currency) }
        val fromCurrency = accounts.find { it.id == form.accountId }?.currency
        val toChoices = accounts
            .filter { (it.usable() || it.id == form.toAccountId) && it.id != form.accountId && it.currency == fromCurrency }
            .sortedBy { it.name.lowercase() }
            .map { Choice(it.id, it.name, it.currency) }
        val categoryChoices = categoryChoices(categories, form.mode.kind(), form.categoryId)
        val modes = when {
            isNew && target !is EditorTarget.Fix -> EntryMode.entries
            editingEntry -> listOf(EntryMode.Expense, EntryMode.Income)
            else -> listOf(form.mode)
        }
        return EditorState(isNew, form, modes, accountChoices, toChoices, categoryChoices, tags, readOnly, canDelete)
    }

    private fun gone() = EditorState(
        isNew = false,
        form = EditorForm(EntryMode.Expense, "", null, null, null, "", "", "", emptyList()),
        modes = emptyList(), accounts = emptyList(), toAccounts = emptyList(), categories = emptyList(), tags = emptyList(),
        readOnly = ReadOnly.Gone,
    )

    private fun entryForm(entry: ShownEntry) = EditorForm(
        mode = if (entry.kind == "income") EntryMode.Income else EntryMode.Expense,
        amount = amountText(entry.amount, entry.currency),
        accountId = entry.accountId,
        toAccountId = null,
        categoryId = entry.categoryId,
        date = entry.date,
        time = entry.time,
        payee = entry.payee.orEmpty(),
        note = entry.note.orEmpty(),
        tagIds = entry.tagIds,
    )

    private fun transferForm(from: ShownEntry, to: ShownEntry) = EditorForm(
        mode = EntryMode.Transfer,
        amount = amountText(-from.amount, from.currency),
        accountId = from.accountId,
        toAccountId = to.accountId,
        categoryId = null,
        date = from.date,
        time = from.time,
        payee = "",
        note = from.note.orEmpty(),
        tagIds = emptyList(),
    )

    private fun transferValues(from: ShownEntry, to: ShownEntry) =
        TransferValues(from.accountId, to.accountId, -from.amount, from.currency, from.date, from.time, from.note)

    private fun entryReadOnly(entry: ShownEntry): ReadOnly? = when {
        entry.isSplit -> ReadOnly.Split
        entry.linked || accounts.find { it.id == entry.accountId }?.contactId != null -> ReadOnly.Linked
        else -> null
    }

    private suspend fun transferReadOnly(from: ShownEntry, to: ShownEntry): ReadOnly? = when {
        from.linked || to.linked || listOf(from.accountId, to.accountId).any { id -> accounts.find { it.id == id }?.contactId != null } -> ReadOnly.Linked
        from.currency != to.currency || -from.amount != to.amount -> ReadOnly.TransferExtras
        from.transferId != null && !from.unsent && reads.transferExtras(ledgerId, from.transferId) > 0 -> ReadOnly.TransferExtras
        else -> null
    }

    private fun AccountRow.usable() = archivedAt == null && contactId == null

    private fun EntryMode.kind() = when (this) {
        EntryMode.Expense -> "expense"
        EntryMode.Income -> "income"
        EntryMode.Transfer -> "transfer"
    }
}
