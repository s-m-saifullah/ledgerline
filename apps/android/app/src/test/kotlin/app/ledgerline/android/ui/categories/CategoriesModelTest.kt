package app.ledgerline.android.ui.categories

import app.ledgerline.android.mirror.CategoryRow
import app.ledgerline.android.mirror.id
import app.ledgerline.android.mirror.syncCategory
import app.ledgerline.android.mirror.toRow
import app.ledgerline.api.ParentChange
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private const val Ledger = "ledger-a"

private fun row(n: Int, name: String = "Category $n", kind: String = "expense", parentN: Int? = null, sortOrder: Long = n.toLong(), archived: Boolean = false, deleted: Boolean = false, version: Int = 1): CategoryRow =
    syncCategory(n, name, kind, parentN, version, sortOrder, archived, if (deleted) "2026-10-22T10:00:00.000Z" else null).toRow(Ledger)

/** The list rules are the web's, on the phone's own copy. */
class CategoriesModelTest {
    private val items = listOf(
        row(1, "Food"), row(2, "Groceries", parentN = 1, sortOrder = 2), row(3, "Dining out", parentN = 1, sortOrder = 1),
        row(4, "Transport", sortOrder = 0), row(5, "Bus pass", parentN = 4, archived = true),
        row(6, "Salary", kind = "income"), row(7, "Old project", archived = true), row(8, "Gone", deleted = true),
        row(9, "Gift", kind = "income", archived = true),
    )

    private fun names(groups: List<CategoryGroup>) = groups.map { g -> g.root.name + g.children.joinToString(prefix = "[", postfix = "]") { it.name } }

    @Test
    fun mainCategoriesAndTheirSubcategoriesAreListedInTheWebsOrder() {
        assertEquals(
            listOf("Transport[Bus pass]", "Food[Dining out, Groceries]", "Old project[]"),
            names(categoryGroups(items, "expense", CategoryStatus.All, "")),
        )
    }

    @Test
    fun siblingsWithTheSameSortOrderFallBackToTheirId() {
        val tied = listOf(row(2, "B", sortOrder = 5), row(1, "A", sortOrder = 5))
        assertEquals(listOf("A", "B"), categoryGroups(tied, "expense", CategoryStatus.All, "").map { it.root.name })
    }

    @Test
    fun theKindSeparatesIncomeFromExpense() {
        assertEquals(listOf("Salary[]", "Gift[]"), names(categoryGroups(items, "income", CategoryStatus.All, "")))
    }

    @Test
    fun aDeletedCategoryIsNeverListed() {
        assertFalse(categoryGroups(items, "expense", CategoryStatus.All, "").any { it.root.name == "Gone" })
    }

    @Test
    fun activeKeepsAMainCategoryAsTheHeadingOfAnActiveSubcategoryOnly() {
        assertEquals(listOf("Transport[]", "Food[Dining out, Groceries]"), names(categoryGroups(items, "expense", CategoryStatus.Active, "")))
    }

    @Test
    fun archivedShowsAnArchivedSubcategoryUnderItsActiveMainCategoryWithoutTheHeading() {
        val groups = categoryGroups(items, "expense", CategoryStatus.Archived, "")
        assertEquals(listOf("Transport[Bus pass]", "Old project[]"), names(groups))
        assertFalse(groups.first().showRoot)
        assertTrue(groups.last().showRoot)
    }

    @Test
    fun theSearchMatchesTheMainAndTheSubcategoryNameIgnoringCase() {
        assertEquals(listOf("Food[Groceries]"), names(categoryGroups(items, "expense", CategoryStatus.All, "  GROCER ")))
        assertEquals(listOf("Food[Dining out, Groceries]"), names(categoryGroups(items, "expense", CategoryStatus.All, "food")))
        assertEquals(emptyList<String>(), names(categoryGroups(items, "expense", CategoryStatus.All, "zzz")))
    }

    @Test
    fun aMainCategoryWithoutSubcategoriesBlocksArchiveOnlyWhenItHasActiveOnes() {
        assertEquals(ActionBlock.ArchiveActiveSubcategoriesFirst, archiveBlock(items[0], items))
        assertNull(archiveBlock(items[3], items.filter { it.parentId != items[3].id || it.archivedAt != null }))
        // Its only subcategory is archived already, so Transport can be archived.
        assertNull(archiveBlock(items[3], items))
        assertNull(archiveBlock(items[1], items))
    }

    @Test
    fun anArchivedSubcategoryCannotBeUnarchivedUnderAnArchivedOrMissingMainCategory() {
        val orphan = row(20, "Orphan", parentN = 99, archived = true)
        assertEquals(ActionBlock.UnarchiveTheMainCategoryFirst, archiveBlock(orphan, items + orphan))
        val under = row(21, "Under old", parentN = 7, archived = true)
        assertEquals(ActionBlock.UnarchiveTheMainCategoryFirst, archiveBlock(under, items + under))
        assertNull(archiveBlock(items[4], items))
        assertNull(archiveBlock(items[6], items))
    }

    @Test
    fun aNewCategoryMayGoUnderAnActiveMainCategoryOfItsKindOnly() {
        assertEquals(listOf("Transport", "Food"), parentChoices(items, "expense", null).map { it.name })
        assertEquals(listOf("Salary"), parentChoices(items, "income", null).map { it.name })
    }

    @Test
    fun anEditedCategoryIsNotItsOwnParentAndAMainCategoryWithSubcategoriesHasNoChoice() {
        assertEquals(emptyList<String>(), parentChoices(items, "expense", items[0]).map { it.name })
        // Transport has only an archived subcategory, which still counts: it stays a main category.
        assertEquals(emptyList<String>(), parentChoices(items, "expense", items[3]).map { it.name })
        assertEquals(listOf("Transport", "Food"), parentChoices(items, "expense", items[1]).map { it.name })
        val lone = row(30, "Lone")
        assertEquals(listOf("Transport", "Food"), parentChoices(items + lone, "expense", lone).map { it.name })
    }

    @Test
    fun aNameMustHaveSomethingInItAndFitTheLimit() {
        assertTrue(CategoryForm.forNew("expense").nameProblem)
        assertTrue(CategoryForm(null, "   ", "expense", null).nameProblem)
        assertFalse(CategoryForm(null, " Pets ", "expense", null).nameProblem)
        assertFalse(CategoryForm(null, "x".repeat(MaxCategoryName), "expense", null).nameProblem)
        assertTrue(CategoryForm(null, "x".repeat(MaxCategoryName + 1), "expense", null).nameProblem)
        assertEquals("Pets", CategoryForm(null, "  Pets ", "expense", null).toCreate().name)
    }

    @Test
    fun aNewCategorySendsItsKindAndParent() {
        val body = CategoryForm(null, "Milk", "expense", id(1)).toCreate()
        assertEquals("Milk", body.name)
        assertEquals("expense", body.kind)
        assertEquals(id(1), body.parentId)
        assertNull(CategoryForm.forNew("income").copy(name = "Tips").toCreate().parentId)
    }

    @Test
    fun anEditSendsOnlyWhatChangedAndAnUnchangedFormChangesNothing() {
        val stored = row(2, "Groceries", parentN = 1, version = 4)
        val same = CategoryForm.forEdit(stored)
        assertFalse(same.changed)
        assertFalse(CategoryForm.forEdit(stored).copy(name = "  Groceries ").changed)
        val renamed = same.copy(name = "Supermarket").toUpdate()
        assertEquals(4, renamed.expectedVersion)
        assertEquals("Supermarket", renamed.name)
        assertEquals(ParentChange.Unchanged, renamed.parentId)
        val toMain = same.copy(parentId = null).toUpdate()
        assertNull(toMain.name)
        assertEquals(ParentChange.MakeMain, toMain.parentId)
        val moved = same.copy(parentId = id(4)).toUpdate()
        assertEquals(ParentChange.MoveUnder(id(4)), moved.parentId)
        assertTrue(same.copy(parentId = id(4)).changed)
    }

    @Test
    fun aNewFormAlwaysCountsAsChanged() = assertTrue(CategoryForm.forNew("expense").changed)
}
