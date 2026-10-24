package app.ledgerline.android.ui.categories

import app.ledgerline.android.mirror.CategoryRow
import app.ledgerline.api.CreateCategory
import app.ledgerline.api.ParentChange
import app.ledgerline.api.UpdateCategory

/** The web's status filter on the Categories page. */
enum class CategoryStatus { All, Active, Archived }

/** A main category with its subcategories as the filters leave them; [showRoot] is false when only a subcategory matches. */
data class CategoryGroup(val root: CategoryRow, val children: List<CategoryRow>, val showRoot: Boolean)

/** Siblings in the web's order: by sort order, then id. */
internal val byOrder: Comparator<CategoryRow> = compareBy({ it.sortOrder }, { it.id })

/**
 * The web's list for one kind (`categories-page.tsx`): each main category with its subcategories in order, filtered by
 * status and by a search over "main sub" (ignoring case). A main category stays as the heading of a matching
 * subcategory even when it does not match itself. A deleted row is never listed.
 */
fun categoryGroups(items: List<CategoryRow>, kind: String, status: CategoryStatus, search: String): List<CategoryGroup> {
    val live = items.filter { it.deletedAt == null }
    val term = search.trim().lowercase()
    fun matches(row: CategoryRow, root: CategoryRow) =
        (status == CategoryStatus.All || (status == CategoryStatus.Archived) == (row.archivedAt != null)) &&
            "${root.name} ${row.name}".lowercase().contains(term)
    return live.filter { it.kind == kind && it.parentId == null }
        .sortedWith(byOrder)
        .map { root ->
            CategoryGroup(
                root,
                live.filter { it.parentId == root.id }.sortedWith(byOrder).filter { matches(it, root) },
                matches(root, root),
            )
        }
        .filter { it.showRoot || it.children.isNotEmpty() }
}

/** Why a category cannot be archived or unarchived right now, as the web's disabled buttons say. */
enum class ActionBlock { ArchiveActiveSubcategoriesFirst, UnarchiveTheMainCategoryFirst }

fun archiveBlock(row: CategoryRow, items: List<CategoryRow>): ActionBlock? = when {
    row.archivedAt != null -> {
        val parent = row.parentId?.let { id -> items.firstOrNull { it.id == id && it.deletedAt == null } }
        if (row.parentId != null && (parent == null || parent.archivedAt != null)) ActionBlock.UnarchiveTheMainCategoryFirst else null
    }
    items.any { it.deletedAt == null && it.parentId == row.id && it.archivedAt == null } -> ActionBlock.ArchiveActiveSubcategoriesFirst
    else -> null
}

/**
 * The main categories a category of [kind] may go under: active ones of that kind, and never the category itself. A
 * main category that has subcategories (archived ones count) cannot become a subcategory, so it is offered none.
 */
fun parentChoices(items: List<CategoryRow>, kind: String, editing: CategoryRow?): List<CategoryRow> {
    val live = items.filter { it.deletedAt == null }
    if (editing != null && live.any { it.parentId == editing.id }) return emptyList()
    return live.filter { it.kind == kind && it.parentId == null && it.archivedAt == null && it.id != editing?.id }.sortedWith(byOrder)
}

/** The longest name the API takes. */
const val MaxCategoryName = 100

/** What the Add / Edit form holds. [editing] is the category being changed, null for a new one. */
data class CategoryForm(
    val editing: CategoryRow?,
    val name: String,
    val kind: String,
    val parentId: String?,
) {
    val trimmedName: String get() = name.trim()

    /** The name is empty or too long. */
    val nameProblem: Boolean get() = trimmedName.isEmpty() || trimmedName.length > MaxCategoryName

    /** Whether saving would change anything (a new category always does). */
    val changed: Boolean get() = editing == null || trimmedName != editing.name || parentId != editing.parentId

    fun toCreate() = CreateCategory(name = trimmedName, kind = kind, parentId = parentId)

    /** Only what differs from the stored category; the kind never changes. */
    fun toUpdate(): UpdateCategory {
        val stored = checkNotNull(editing)
        return UpdateCategory(
            expectedVersion = stored.version,
            name = trimmedName.takeIf { it != stored.name },
            parentId = when {
                parentId == stored.parentId -> ParentChange.Unchanged
                parentId == null -> ParentChange.MakeMain
                else -> ParentChange.MoveUnder(parentId)
            },
        )
    }

    companion object {
        fun forNew(kind: String) = CategoryForm(null, "", kind, null)

        fun forEdit(row: CategoryRow) = CategoryForm(row, row.name, row.kind, row.parentId)
    }
}
