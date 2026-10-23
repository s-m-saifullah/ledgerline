package app.ledgerline.android.ui.editor

import app.ledgerline.android.mirror.CategoryRow
import org.junit.Assert.assertEquals
import org.junit.Test

/** The category list the picker searches: the web's order, archived ones only while chosen. */
class CategoryChoicesTest {
    private fun row(id: String, name: String, parent: String? = null, kind: String = "expense", order: Long = 0, archived: Boolean = false) =
        CategoryRow("l", id, 1, "t", "t", null, parent, name, kind, null, null, order, if (archived) "t" else null)

    private val rows = listOf(
        row("b", "Bills", order = 2),
        row("a", "Food", order = 1),
        row("a2", "Restaurants", parent = "a", order = 2),
        row("a1", "Groceries", parent = "a", order = 1),
        row("b1", "Power", parent = "b", order = 1),
        row("i", "Salary", kind = "income"),
    )

    @Test
    fun eachMainCategoryIsFollowedByItsSubcategoriesInSortOrder() {
        assertEquals(
            listOf("Food", "Food › Groceries", "Food › Restaurants", "Bills", "Bills › Power"),
            categoryChoices(rows, "expense", null).map { it.label },
        )
    }

    @Test
    fun onlyTheKindAskedForIsOffered() {
        assertEquals(listOf("Salary"), categoryChoices(rows, "income", null).map { it.label })
        assertEquals(emptyList<Choice>(), categoryChoices(rows, "transfer", null))
    }

    @Test
    fun anArchivedCategoryAndTheOnesUnderAnArchivedMainCategoryAreLeftOut() {
        val withArchived = rows + row("x", "Old", archived = true) + row("a3", "Cafes", parent = "a", order = 3, archived = true)
        assertEquals(
            listOf("Food", "Food › Groceries", "Food › Restaurants", "Bills", "Bills › Power"),
            categoryChoices(withArchived, "expense", null).map { it.label },
        )
        val archivedFood = rows.map { if (it.id == "a") it.copy(archivedAt = "t") else it }
        assertEquals(listOf("Bills", "Bills › Power"), categoryChoices(archivedFood, "expense", null).map { it.label })
    }

    @Test
    fun anArchivedCurrentChoiceStaysAndIsMarkedArchived() {
        val withArchived = rows + row("x", "Old", archived = true)
        val chosen = categoryChoices(withArchived, "expense", "x")
        assertEquals(Choice("x", "Old", archived = true), chosen.single { it.id == "x" })
        assertEquals(false, chosen.single { it.id == "a" }.archived)
    }

    @Test
    fun aSubcategoryWhoseMainCategoryIsGoneIsStillOffered() {
        assertEquals(listOf("Lost"), categoryChoices(listOf(row("z", "Lost", parent = "missing")), "expense", null).map { it.label })
    }

    @Test
    fun matchingIgnoresCaseAndSurroundingSpacesAndSearchesTheWholeLabel() {
        val choices = categoryChoices(rows, "expense", null)
        assertEquals(listOf("Food › Groceries"), choices.matching(" GROC ").map { it.label })
        assertEquals(listOf("Food › Groceries", "Food › Restaurants"), choices.matching("food ›").filter { it.label.contains("›") }.map { it.label })
        assertEquals(choices, choices.matching("  "))
        assertEquals(emptyList<Choice>(), choices.matching("zzz"))
    }
}
