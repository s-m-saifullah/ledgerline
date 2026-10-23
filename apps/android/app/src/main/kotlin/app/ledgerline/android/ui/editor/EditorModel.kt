package app.ledgerline.android.ui.editor

import android.content.Context
import app.ledgerline.android.mirror.CategoryRow
import androidx.core.content.edit
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Inject
import javax.inject.Singleton

enum class EntryMode { Expense, Income, Transfer }

/** What the editor opens on. Encoded as text so the screen can keep it across a rotation. */
sealed interface EditorTarget {
    data class New(val mode: EntryMode = EntryMode.Expense) : EditorTarget
    data class Entry(val id: String) : EditorTarget
    data class Transfer(val transferId: String) : EditorTarget

    /** A change the server rejected, opened to correct and send again. */
    data class Fix(val outboxId: String) : EditorTarget

    fun encode(): String = when (this) {
        is New -> "new:${mode.name}"
        is Entry -> "entry:$id"
        is Transfer -> "transfer:$transferId"
        is Fix -> "fix:$outboxId"
    }

    companion object {
        fun decode(text: String): EditorTarget {
            val (kind, value) = text.split(":", limit = 2)
            return when (kind) {
                "new" -> New(EntryMode.valueOf(value))
                "entry" -> Entry(value)
                "transfer" -> Transfer(value)
                else -> Fix(value)
            }
        }
    }
}

/** Why an entry cannot be edited on the phone (it is shown, and edited on the web). */
enum class ReadOnly { Split, Linked, TransferExtras, Gone }

enum class FormError {
    AmountMissing, AmountInvalid, AmountTooPrecise, AmountZero, AmountTooLarge,
    AccountMissing, ToAccountMissing, SameAccount, CategoryMissing, CouldNotSave,
}

/** One entry of a list the owner picks from; [archived] ones are offered only while they are the current choice. */
data class Choice(val id: String, val label: String, val currency: String = "", val archived: Boolean = false)

/**
 * The categories of one kind in the web's order: each main category with its subcategories under it, by their sort
 * order. Archived ones are left out unless one is the current choice, which then shows as archived.
 */
internal fun categoryChoices(categories: List<CategoryRow>, kind: String, selectedId: String?): List<Choice> {
    val ofKind = categories.filter { it.kind == kind }
    val ids = ofKind.map { it.id }.toSet()
    val order = compareBy<CategoryRow>({ it.sortOrder }, { it.id })
    // A subcategory whose main category is gone is listed as a main one rather than lost.
    val roots = ofKind.filter { it.parentId == null || it.parentId !in ids }.sortedWith(order)
    val children = ofKind.filter { it.parentId in ids }.groupBy { it.parentId }
    return roots.flatMap { root ->
        (listOf(root) + children[root.id].orEmpty().sortedWith(order)).mapNotNull { category ->
            val archived = category.archivedAt != null || root.archivedAt != null
            if (archived && category.id != selectedId) return@mapNotNull null
            val label = if (category.id != root.id) "${root.name} › ${category.name}" else category.name
            Choice(category.id, label, archived = archived)
        }
    }
}

/** The most tags one entry can have (the server's limit, as the web's picker). */
const val MaxTagsPerEntry = 10

data class EditorForm(
    val mode: EntryMode,
    val amount: String,
    val accountId: String?,
    val toAccountId: String?,
    val categoryId: String?,
    val date: String,
    val payee: String,
    val note: String,
    val tagIds: List<String>,
    /** "HH:mm", or null: empty for a new entry, as on the web. */
    val time: String? = null,
)

data class EditorState(
    val isNew: Boolean,
    val form: EditorForm,
    /** The kinds the owner may switch between: all three for a new entry, expense and income for an entry. */
    val modes: List<EntryMode>,
    val accounts: List<Choice>,
    val toAccounts: List<Choice>,
    val categories: List<Choice>,
    val tags: List<Choice>,
    val readOnly: ReadOnly? = null,
    val canDelete: Boolean = false,
    val errors: Set<FormError> = emptySet(),
    val saving: Boolean = false,
    val done: Boolean = false,
    /** The opening of the editor this state belongs to; a later opening never sees an earlier one's state. */
    val session: String = "",
)

/** The account and categories used last, so a new entry is mostly filled in already. */
interface FormMemory {
    fun account(): String?

    fun category(kind: String): String?

    fun remember(accountId: String, kind: String, categoryId: String?)
}

@Singleton
class PrefsFormMemory @Inject constructor(@ApplicationContext context: Context) : FormMemory {
    private val prefs = context.getSharedPreferences("editor", Context.MODE_PRIVATE)

    override fun account() = prefs.getString("account", null)

    override fun category(kind: String) = prefs.getString("category_$kind", null)

    override fun remember(accountId: String, kind: String, categoryId: String?) = prefs.edit {
        putString("account", accountId)
        if (kind != "transfer") putString("category_$kind", categoryId)
    }
}

@Module
@InstallIn(SingletonComponent::class)
abstract class FormMemoryModule {
    @Binds
    abstract fun bindFormMemory(memory: PrefsFormMemory): FormMemory
}
