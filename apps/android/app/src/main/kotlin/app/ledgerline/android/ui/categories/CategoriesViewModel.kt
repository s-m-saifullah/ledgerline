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

/** What just worked, said once under the toolbar. */
enum class CategoryNotice { Added, Updated, Archived, Unarchived }

/** One archive question waiting for an answer. */
data class ArchiveAsk(val category: CategoryRow)

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
)

/**
 * Categories (ADR 0043, categories PRs): the list reads the phone's own copy, so it works offline; adding, editing and
 * archiving go online as one idempotent call each. A write keeps its Idempotency-Key for the same change, so a reply
 * lost on the way and a second tap cannot make two categories; a changed form gets a new key.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class CategoriesViewModel @Inject constructor(
    reads: MirrorReads,
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
        all?.let { categoryGroups(it, v.kind, v.status, v.search) }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    fun setKind(kind: String) = _view.update { it.copy(kind = kind, notice = null) }

    fun setStatus(status: CategoryStatus) = _view.update { it.copy(status = status, notice = null) }

    fun setSearch(text: String) = _view.update { it.copy(search = text) }

    fun startAdd() = _view.update { it.copy(form = CategoryForm.forNew(it.kind), error = null, notice = null) }

    fun startEdit(row: CategoryRow) = _view.update { it.copy(form = CategoryForm.forEdit(row), error = null, notice = null) }

    fun edit(change: (CategoryForm) -> CategoryForm) = _view.update { v -> v.copy(form = v.form?.let(change), error = null) }

    fun closeForm() {
        if (_view.value.saving) return
        keys.clear()
        _view.update { it.copy(form = null, error = null) }
    }

    fun askArchive(row: CategoryRow) = _view.update { it.copy(ask = ArchiveAsk(row), error = null, notice = null) }

    fun dismissAsk() = _view.update { it.copy(ask = null) }

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
        run(ledgerId, if (editing == null) CategoryNotice.Added else CategoryNotice.Updated, closeForm = true) {
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
        run(ledgerId, CategoryNotice.Unarchived, closeForm = false) { writes.unarchive(ledgerId, row.id, key, row.version) }
    }

    private fun keyFor(change: String) = keys.getOrPut(change) { "cat-${Uuid7.next()}" }

    private fun run(ledgerId: String, done: CategoryNotice, closeForm: Boolean, call: suspend () -> Written<CategoryRow>) {
        _view.update { it.copy(saving = true, error = null, notice = null) }
        viewModelScope.launch {
            val result = call()
            _view.update { v ->
                when (result) {
                    is Written.Done -> {
                        keys.clear()
                        v.copy(saving = false, notice = done, form = if (closeForm) null else v.form)
                    }
                    Written.Offline -> v.copy(saving = false, error = CategoryError.Offline)
                    Written.Forbidden -> v.copy(saving = false, error = CategoryError.Forbidden)
                    Written.Failed -> v.copy(saving = false, error = CategoryError.Failed)
                    is Written.Rejected -> v.copy(saving = false, error = CategoryError.Rejected(result.detail))
                }
            }
            // A version that moved on (an edit on the web, say) is answered with 409; bring this phone up to date.
            if (result is Written.Rejected && result.status == 409) sync.pullNow()
        }
    }

}
