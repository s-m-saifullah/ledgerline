package app.ledgerline.android.ui.categories

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.mirror.CategoryRow
import app.ledgerline.android.mirror.MirrorReads
import app.ledgerline.android.online.CategoryWrites
import app.ledgerline.android.online.Written
import app.ledgerline.android.outbox.Uuid7
import app.ledgerline.android.sync.SyncCoordinator
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Why a write did not go through, for the screen to word. */
sealed interface CategoryError {
    data object Offline : CategoryError

    data object Forbidden : CategoryError

    data object Failed : CategoryError

    /** The server's own sentence (a duplicate name, two levels only, ...); null when it gave none. */
    data class Rejected(val detail: String?) : CategoryError
}

/** The error a write ended with, or null when it was done. */
internal fun Written<*>.toCategoryError(): CategoryError? = when (this) {
    is Written.Done -> null
    Written.Offline -> CategoryError.Offline
    Written.Forbidden -> CategoryError.Forbidden
    Written.Failed -> CategoryError.Failed
    is Written.Rejected -> CategoryError.Rejected(detail)
}

/** What just worked, said once under the toolbar. */
enum class CategoryNotice { Added, Updated, Archived, Unarchived, Deleted }

/** One archive question waiting for an answer. */
data class ArchiveAsk(val category: CategoryRow)

/** One delete question: [block] is what stops it (then the dialog explains and recommends archiving), null when it may go ahead. */
data class DeleteAsk(val category: CategoryRow, val block: DeleteBlock?, val canArchiveInstead: Boolean)

/** Everything the screen shows besides the categories themselves. */
data class CategoriesView(
    val kind: String = "expense",
    val status: CategoryStatus = CategoryStatus.All,
    val search: String = "",
    val form: CategoryForm? = null,
    val saving: Boolean = false,
    val error: CategoryError? = null,
    val notice: CategoryNotice? = null,
    val ask: ArchiveAsk? = null,
    val deleteAsk: DeleteAsk? = null,
    /** The ids of the main categories opened to show their subcategories. */
    val expanded: Set<String> = emptySet(),
    /** The category whose actions sheet is open. */
    val menu: CategoryRow? = null,
)

/**
 * Categories (ADR 0043, categories PRs): the list reads the phone's own copy, so it works offline; adding, editing and
 * archiving go online as one idempotent call each. A write keeps its Idempotency-Key for the same change, so a reply
 * lost on the way and a second tap cannot make two categories; a changed form gets a new key.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class CategoriesViewModel @Inject constructor(
    private val reads: MirrorReads,
    private val writes: CategoryWrites,
    private val sync: SyncCoordinator,
) : ViewModel() {
    private val ledger: StateFlow<String?> = reads.mirroredLedger().stateIn(viewModelScope, SharingStarted.Eagerly, null)
    private val _view = MutableStateFlow(CategoriesView())
    private val keys = mutableMapOf<String, String>()

    val view: StateFlow<CategoriesView> = _view
    val items: StateFlow<List<CategoryRow>?> = ledger
        .flatMapLatest { id -> if (id == null) flowOf(null) else reads.liveCategories(id) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** The groups for the chosen kind, status and search; null until the mirror has a ledger. */
    val groups: StateFlow<List<CategoryGroup>?> = combine(items, _view) { all, v ->
        all?.let { categoryGroups(it, v.kind, effectiveStatus(it, v.kind, v.status), v.search) }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    fun setKind(kind: String) = _view.update { it.copy(kind = kind, notice = null) }

    fun setStatus(status: CategoryStatus) = _view.update { it.copy(status = status, notice = null) }

    fun setSearch(text: String) = _view.update { it.copy(search = text) }

    fun startAdd() = _view.update { it.copy(form = CategoryForm.forNew(it.kind), menu = null, error = null, notice = null) }

    /** Add under [parent]: the form opens with its kind and the parent chosen. */
    fun startAddUnder(parent: CategoryRow) =
        _view.update { it.copy(form = CategoryForm.forNew(parent.kind).copy(parentId = parent.id), menu = null, error = null, notice = null) }

    fun startEdit(row: CategoryRow) = _view.update { it.copy(form = CategoryForm.forEdit(row), menu = null, error = null, notice = null) }

    fun openMenu(row: CategoryRow) = _view.update { it.copy(menu = row, error = null, notice = null) }

    fun closeMenu() = _view.update { it.copy(menu = null) }

    fun toggleGroup(id: String) = _view.update { it.copy(expanded = if (id in it.expanded) it.expanded - id else it.expanded + id) }

    /** Opens every group in [ids], or closes them all when they are all open already. */
    fun toggleAll(ids: List<String>) = _view.update { it.copy(expanded = if (ids.all { id -> id in it.expanded }) it.expanded - ids.toSet() else it.expanded + ids) }

    fun edit(change: (CategoryForm) -> CategoryForm) = _view.update { v -> v.copy(form = v.form?.let(change), error = null) }

    fun closeForm() {
        if (_view.value.saving) return
        keys.clear()
        _view.update { it.copy(form = null, error = null) }
    }

    fun askArchive(row: CategoryRow) = _view.update { it.copy(ask = ArchiveAsk(row), menu = null, error = null, notice = null) }

    fun dismissAsk() = _view.update { it.copy(ask = null) }

    /**
     * Opens the delete question. The phone looks first at what uses the category (subcategories, entries, unsent changes);
     * if anything does, the question says so and recommends archiving, as the web does, and nothing is sent.
     */
    fun askDelete(row: CategoryRow) {
        val ledgerId = ledger.value ?: return
        _view.update { it.copy(menu = null, error = null, notice = null) }
        viewModelScope.launch {
            val block = deleteBlock(row, items.value.orEmpty(), reads.entriesUsingCategory(ledgerId, row.id))
            // Archiving is the way out when something uses the category, unless it is archived already or has active subcategories.
            val canArchive = row.archivedAt == null && archiveBlock(row, items.value.orEmpty()) == null
            _view.update { it.copy(deleteAsk = DeleteAsk(row, block, canArchiveInstead = canArchive)) }
        }
    }

    fun dismissDeleteAsk() = _view.update { it.copy(deleteAsk = null) }

    /** Deletes the category the question is about, when nothing stopped it. */
    fun confirmDelete() {
        val ask = _view.value.deleteAsk ?: return
        if (ask.block != null) return
        val ledgerId = ledger.value ?: return
        val key = keyFor("delete|${ask.category.id}|${ask.category.version}")
        _view.update { it.copy(deleteAsk = null) }
        run(ledgerId, CategoryNotice.Deleted, closeForm = false) { writes.delete(ledgerId, ask.category, key) }
    }

    /** From a question that says the category is in use: go on to archiving it, which keeps its history. */
    fun archiveInstead() {
        val ask = _view.value.deleteAsk ?: return
        if (!ask.canArchiveInstead) return
        _view.update { it.copy(deleteAsk = null, ask = ArchiveAsk(ask.category)) }
    }

    fun dismissNotice() = _view.update { it.copy(notice = null) }

    /** Saves the form: an add, or an edit of only what changed. */
    fun save() {
        val v = _view.value
        val form = v.form ?: return
        if (v.saving || form.nameProblem) return
        val ledgerId = ledger.value ?: return
        if (!form.changed) return closeForm()
        val editing = form.editing
        val key = keyFor(if (editing == null) "create|${form.trimmedName}|${form.kind}|${form.parentId}" else "update|${editing.id}|${editing.version}|${form.trimmedName}|${form.parentId}")
        // A new subcategory opens its main category, so the owner sees it land.
        run(ledgerId, if (editing == null) CategoryNotice.Added else CategoryNotice.Updated, closeForm = true, expand = form.parentId.takeIf { editing == null }) {
            if (editing == null) writes.create(ledgerId, key, form.toCreate()) else writes.update(ledgerId, editing.id, key, form.toUpdate())
        }
    }

    /** Archives the category the question is about. */
    fun confirmArchive() {
        val row = _view.value.ask?.category ?: return
        val ledgerId = ledger.value ?: return
        val key = keyFor("archive|${row.id}|${row.version}")
        _view.update { it.copy(ask = null) }
        run(ledgerId, CategoryNotice.Archived, closeForm = false) { writes.archive(ledgerId, row.id, key, row.version) }
    }

    fun unarchive(row: CategoryRow) {
        val ledgerId = ledger.value ?: return
        val key = keyFor("unarchive|${row.id}|${row.version}")
        _view.update { it.copy(menu = null) }
        run(ledgerId, CategoryNotice.Unarchived, closeForm = false) { writes.unarchive(ledgerId, row.id, key, row.version) }
    }

    private fun keyFor(change: String) = keys.getOrPut(change) { "cat-${Uuid7.next()}" }

    private fun run(ledgerId: String, done: CategoryNotice, closeForm: Boolean, expand: String? = null, call: suspend () -> Written<*>) {
        _view.update { it.copy(saving = true, error = null, notice = null) }
        viewModelScope.launch {
            val result = call()
            _view.update { v ->
                if (result is Written.Done) {
                    keys.clear()
                    v.copy(saving = false, notice = done, form = if (closeForm) null else v.form, expanded = if (expand != null) v.expanded + expand else v.expanded)
                } else {
                    v.copy(saving = false, error = result.toCategoryError())
                }
            }
            // A version that moved on (an edit on the web, say) is answered with 409, a category already gone with 404; bring this phone up to date.
            if (result is Written.Rejected && (result.status == 409 || result.status == 404)) sync.pullNow()
        }
    }

}
