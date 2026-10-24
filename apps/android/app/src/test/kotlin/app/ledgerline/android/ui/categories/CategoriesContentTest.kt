package app.ledgerline.android.ui.categories

import android.app.Application
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.unit.dp
import app.ledgerline.android.mirror.CategoryRow
import app.ledgerline.android.mirror.id
import app.ledgerline.android.mirror.syncCategory
import app.ledgerline.android.mirror.toRow
import app.ledgerline.android.ui.more.MoreActions
import app.ledgerline.android.ui.more.MoreContent
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

private fun row(n: Int, name: String, parentN: Int? = null, kind: String = "expense", archived: Boolean = false, version: Int = 1): CategoryRow =
    syncCategory(n, name, kind, parentN, version, n.toLong(), archived).toRow("ledger-a")

/** The Categories screen as plain data: what is listed, what each control reports, and what the form says. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class CategoriesContentTest {
    @get:Rule
    val compose = createComposeRule()

    private class Taps {
        val log = mutableListOf<String>()
        var forms = mutableListOf<CategoryForm>()

        fun actions(start: CategoryForm? = null) = CategoriesActions(
            onBack = { log += "back" },
            setKind = { log += "kind:$it" },
            setStatus = { log += "status:${it.name}" },
            setSearch = { log += "search:$it" },
            add = { log += "add" },
            edit = { log += "edit:${it.name}" },
            askArchive = { log += "ask:${it.name}" },
            unarchive = { log += "unarchive:${it.name}" },
            changeForm = { change -> forms += change(start ?: CategoryForm.forNew("expense")) },
            save = { log += "save" },
            closeForm = { log += "closeForm" },
            confirmArchive = { log += "confirm" },
            dismissAsk = { log += "dismiss" },
        )
    }

    private val food = row(1, "Food")
    private val groceries = row(2, "Groceries", parentN = 1)
    private val old = row(3, "Old project", archived = true)
    private val items = listOf(food, groceries, old, row(4, "Salary", kind = "income"))

    private fun show(view: CategoriesView = CategoriesView(), groups: List<CategoryGroup>? = categoryGroups(items, view.kind, view.status, view.search), taps: Taps = Taps()): Taps {
        compose.setContent { CategoriesContent(view, groups, items, taps.actions(view.form), 0.dp, Modifier.requiredHeight(3000.dp)) }
        return taps
    }

    @Test
    fun theListShowsEachMainCategoryWithItsSubcategoriesAndAnArchivedBadge() {
        show()
        compose.onNodeWithText("Food").assertExists()
        compose.onNodeWithText("Groceries").assertExists()
        compose.onNodeWithText("Old project").assertExists()
        compose.onNodeWithText("Archived").assertExists()
        compose.onNodeWithText("Salary").assertDoesNotExist()
    }

    @Test
    fun theTopControlsReportWhatWasDone() {
        val taps = show()
        compose.onNodeWithText("Add category").performClick()
        compose.onNodeWithText("Income").performClick()
        compose.onNodeWithText("←  More").performClick()
        compose.onNode(hasSetTextAction()).performTextReplacement("gro")
        assertEquals(listOf("add", "kind:income", "back", "search:gro"), taps.log)
        compose.onNodeWithText("Expense").assertIsSelected()
    }

    @Test
    fun aRowsMenuOffersEditAndArchiveAndArchiveIsBlockedWhileItHasActiveSubcategories() {
        val taps = show()
        compose.onNodeWithContentDescription("Actions for Groceries").performClick()
        compose.onNodeWithText("Edit category").performClick()
        compose.onNodeWithContentDescription("Actions for Groceries").performClick()
        compose.onNodeWithText("Archive category").performClick()
        compose.onNodeWithContentDescription("Actions for Food").performClick()
        compose.onNodeWithText("Archive active subcategories first").assertIsNotEnabled()
        assertEquals(listOf("edit:Groceries", "ask:Groceries"), taps.log)
    }

    @Test
    fun anArchivedCategoryCanBeUnarchivedUnlessItsMainCategoryIsArchived() {
        val taps = show()
        compose.onNodeWithContentDescription("Actions for Old project").performClick()
        compose.onNodeWithText("Unarchive category").assertIsEnabled().performClick()
        assertEquals(listOf("unarchive:Old project"), taps.log)
    }

    @Test
    fun aSubcategoryUnderAnArchivedMainCategoryExplainsWhyItCannotBeUnarchived() {
        val parent = row(10, "Parent", archived = true)
        val child = row(11, "Child", parentN = 10, archived = true)
        val everything = listOf(parent, child)
        compose.setContent {
            CategoriesContent(
                CategoriesView(), categoryGroups(everything, "expense", CategoryStatus.All, ""), everything, Taps().actions(), 0.dp,
                Modifier.requiredHeight(3000.dp),
            )
        }
        compose.onNodeWithContentDescription("Actions for Child").performClick()
        compose.onNodeWithText("Unarchive the main category first").assertIsNotEnabled()
    }

    @Test
    fun anEmptyLedgerAndAnEmptyFilterSayDifferentThings() {
        compose.setContent { CategoriesContent(CategoriesView(), emptyList(), emptyList(), Taps().actions(), 0.dp, Modifier.requiredHeight(3000.dp)) }
        compose.onNodeWithText("Make room for your categories.").assertExists()
    }

    @Test
    fun aSearchWithNoMatchIsNotTheEmptyLedger() {
        show(CategoriesView(search = "zzz"))
        compose.onNodeWithText("No matching categories.").assertExists()
        compose.onNodeWithText("Make room for your categories.").assertDoesNotExist()
    }

    @Test
    fun whileTheMirrorHasNoLedgerTheScreenSaysItIsOpening() {
        show(groups = null)
        compose.onNodeWithText("Opening your categories…").assertExists()
        compose.onNodeWithText("Add category").assertDoesNotExist()
    }

    @Test
    fun aNoticeAndAnErrorAreShownInWords() {
        show(CategoriesView(notice = CategoryNotice.Archived))
        compose.onNodeWithText("Category archived. Its label and history are kept.").assertExists()
    }

    @Test
    fun everyErrorIsWordedAndTheServersSentenceIsShownAsItIs() {
        val form = CategoryForm.forNew("expense").copy(name = "Food")
        val cases = mapOf(
            CategoryError.Offline to "needs a connection",
            CategoryError.Forbidden to "can't change categories",
            CategoryError.Failed to "Couldn't save the category",
            CategoryError.Rejected("A sibling category already has this name.") to "A sibling category already has this name.",
            CategoryError.Rejected(null) to "didn't accept this change",
        )
        var shown by mutableStateOf<CategoryError?>(null)
        compose.setContent {
            CategoryFormContent(form, emptyList(), false, false, shown, Taps().actions(form), 0.dp, Modifier.requiredHeight(3000.dp))
        }
        for ((error, text) in cases) {
            compose.runOnIdle { shown = error }
            compose.onNodeWithText(text, substring = true).assertExists()
        }
    }

    @Test
    fun theArchiveQuestionNamesTheCategoryAndReportsTheAnswer() {
        val taps = show(CategoriesView(ask = ArchiveAsk(food)))
        compose.onNodeWithText("Archive Food?", substring = true).assertExists()
        compose.onNodeWithText("Archive").performClick()
        assertEquals(listOf("confirm"), taps.log)
    }

    @Test
    fun cancellingTheArchiveQuestionReportsIt() {
        val taps = show(CategoriesView(ask = ArchiveAsk(food)))
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(listOf("dismiss"), taps.log)
    }

    /** The form's save button: the page title says the same words, so the button is the one that can be clicked. */
    private fun saveButton(text: String) = compose.onNode(hasText(text) and hasClickAction())

    private fun showForm(form: CategoryForm, parents: List<CategoryRow> = emptyList(), hasSubcategories: Boolean = false, saving: Boolean = false, error: CategoryError? = null, taps: Taps = Taps()): Taps {
        compose.setContent { CategoryFormContent(form, parents, hasSubcategories, saving, error, taps.actions(form), 0.dp, Modifier.requiredHeight(3000.dp)) }
        return taps
    }

    @Test
    fun theAddFormStartsEmptyWithTheSaveButtonOff() {
        showForm(CategoryForm.forNew("expense"))
        compose.onNodeWithText("Category name").assertExists()
        saveButton("Add category").assertExists()
        saveButton("Add category").assertIsNotEnabled()
        compose.onNodeWithText("Enter a name.").assertDoesNotExist()
    }

    @Test
    fun typingAnameChangesTheFormAndSavingReportsIt() {
        val taps = showForm(CategoryForm.forNew("expense").copy(name = "Pets"))
        saveButton("Add category").assertIsEnabled().performClick()
        compose.onNode(hasSetTextAction()).performTextReplacement("Pets and vets")
        assertEquals(listOf("save"), taps.log)
        assertEquals("Pets and vets", taps.forms.single().name)
    }

    @Test
    fun aNameTooLongIsRefusedBeforeAnythingIsSent() {
        showForm(CategoryForm.forNew("expense").copy(name = "x".repeat(101)))
        compose.onNodeWithText("Use 100 characters or fewer.").assertExists()
        saveButton("Add category").assertIsNotEnabled()
    }

    @Test
    fun theParentCanBeChosenFromTheActiveMainCategories() {
        val taps = showForm(CategoryForm.forNew("expense").copy(name = "Milk"), parents = listOf(food))
        compose.onNodeWithContentDescription("Parent category").performClick()
        compose.onNodeWithText("Food").performClick()
        assertEquals(id(1), taps.forms.single().parentId)
    }

    @Test
    fun theKindCanBeChosenOnlyForANewCategory() {
        val taps = showForm(CategoryForm.forNew("expense"))
        compose.onNodeWithText("Income").performClick()
        assertEquals("income", taps.forms.single().kind)
    }

    @Test
    fun anEditFormShowsTheFixedKindAndSavesWithChangesOnly() {
        val form = CategoryForm.forEdit(groceries)
        showForm(form)
        compose.onNodeWithText("Save changes").assertExists()
        compose.onNodeWithText("Expense (the kind of an existing category cannot change)").assertExists()
        compose.onNodeWithText("Income").assertDoesNotExist()
    }

    @Test
    fun aMainCategoryWithSubcategoriesCannotBeGivenAParent() {
        showForm(CategoryForm.forEdit(food), hasSubcategories = true)
        compose.onNodeWithContentDescription("Parent category").assertDoesNotExist()
        compose.onNodeWithText("This category has subcategories", substring = true).assertExists()
    }

    @Test
    fun whileSavingTheFormSaysSoAndCannotBeChanged() {
        showForm(CategoryForm.forNew("expense").copy(name = "Pets"), saving = true)
        compose.onNodeWithText("Saving…").assertIsNotEnabled()
        compose.onNodeWithText("Cancel").assertIsNotEnabled()
    }

    @Test
    fun cancelAndTheBackLinkCloseTheForm() {
        val taps = showForm(CategoryForm.forNew("expense"))
        compose.onNodeWithText("Cancel").performClick()
        compose.onNodeWithText("←  Categories").performClick()
        assertEquals(listOf("closeForm", "closeForm"), taps.log)
    }

    @Test
    fun moreHasACategoriesCardThatOpensTheScreen() {
        val log = mutableListOf<String>()
        compose.setContent { MoreContent(MoreActions({}, {}, { log += "categories" }, {}), 0.dp, Modifier.requiredHeight(3000.dp)) }
        compose.onNodeWithContentDescription("Categories", substring = true).performClick()
        assertEquals(listOf("categories"), log)
    }
}
