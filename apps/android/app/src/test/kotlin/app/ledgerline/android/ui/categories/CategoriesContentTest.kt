package app.ledgerline.android.ui.categories

import android.app.Application
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.swipeDown
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.click
import androidx.compose.ui.test.centerLeft
import androidx.compose.ui.geometry.Offset
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

/** What the screen's controls report, as a log a test can read. */
internal class Taps {
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
        askDelete = { log += "askDelete:${it.name}" },
        confirmDelete = { log += "confirmDelete" },
        dismissDeleteAsk = { log += "dismissDelete" },
        archiveInstead = { log += "archiveInstead" },
        openMenu = { log += "menu:${it.name}" },
        closeMenu = { log += "closeMenu" },
        addUnder = { log += "addUnder:${it.name}" },
        toggleGroup = { log += "toggle:$it" },
        toggleAll = { log += "toggleAll:${it.size}" },
    )
}

/** The Categories screen as plain data: what is listed, what each control reports, and what the sheets say. */
@OptIn(ExperimentalMaterial3Api::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class CategoriesContentTest {
    @get:Rule
    val compose = createComposeRule()

    private val food = row(1, "Food")
    private val groceries = row(2, "Groceries", parentN = 1)
    private val old = row(3, "Old project", archived = true)
    private val items = listOf(food, groceries, old, row(4, "Salary", kind = "income"))

    private fun show(
        view: CategoriesView = CategoriesView(),
        shown: List<CategoryRow> = items,
        groups: List<CategoryGroup>? = categoryGroups(shown, view.kind, effectiveStatus(shown, view.kind, view.status), view.search),
        taps: Taps = Taps(),
    ): Taps {
        compose.setContent { CategoriesContent(view, groups, shown, taps.actions(view.form), 0.dp, Modifier.requiredHeight(3000.dp)) }
        return taps
    }

    @Test
    fun aGroupIsClosedUntilOpenedAndThenShowsItsSubcategories() {
        show()
        compose.onNodeWithText("Food").assertExists()
        compose.onNodeWithText("Groceries").assertDoesNotExist()
        compose.onNodeWithText("Old project").assertExists()
        compose.onNodeWithText("Salary").assertDoesNotExist()
    }

    @Test
    fun anOpenGroupShowsItsSubcategoriesAndAnArchivedHint() {
        val sub = row(5, "Old sub", parentN = 1, archived = true)
        show(CategoriesView(expanded = setOf(id(1))), shown = items + sub)
        compose.onNodeWithText("Groceries").assertExists()
        compose.onNodeWithText("Old sub").assertExists()
        // The Archived chip, the archived group and the archived subcategory each say so, in a word.
        compose.onAllNodesWithText("Archived").assertCountEquals(3)
    }

    @Test
    fun aGroupShowsHowManySubcategoriesItHasAndAnArchivedOneSaysArchivedInstead() {
        show(shown = items + row(5, "Dining out", parentN = 1))
        compose.onNodeWithText("2 subcategories").assertExists()
        compose.onAllNodesWithText("Archived").assertCountEquals(2)
    }

    @Test
    fun theTopBarAndSegmentsAndSearchReportWhatWasDone() {
        val taps = show()
        compose.onNodeWithContentDescription("Add category").performClick()
        compose.onNodeWithText("Income (1)").performClick()
        compose.onNode(hasSetTextAction()).performTextReplacement("gro")
        compose.onNodeWithContentDescription("Back").performClick()
        assertEquals(listOf("add", "kind:income", "search:gro", "back"), taps.log)
        compose.onNodeWithText("Expense (2)").assertIsSelected()
    }

    @Test
    fun theListCardIsAsWideAsTheHeaderFields() {
        show()
        val search = compose.onNode(hasSetTextAction()).getUnclippedBoundsInRoot()
        val firstRow = compose.onNodeWithText("Food").getUnclippedBoundsInRoot()
        assertEquals(search.left.value, firstRow.left.value, 0.5f)
        assertEquals(search.right.value, firstRow.right.value, 0.5f)
    }

    @Test
    fun pullingDownOnTheEmptySpaceUnderAShortListRefreshes() {
        var refreshes = 0
        compose.setContent {
            PullToRefreshBox(isRefreshing = false, onRefresh = { refreshes++ }, modifier = Modifier.requiredHeight(1400.dp)) {
                CategoriesContent(CategoriesView(), categoryGroups(items, "expense", CategoryStatus.All, ""), items, Taps().actions(), 0.dp, Modifier.fillMaxSize())
            }
        }
        compose.onRoot().performTouchInput { swipeDown(startY = height * 0.4f, endY = height * 0.98f, durationMillis = 600) }
        compose.waitForIdle()
        assertEquals(1, refreshes)
    }

    @Test
    fun theSegmentsCountMainCategoriesOfEachKindWhateverTheFilter() {
        show(CategoriesView(search = "zzz"))
        compose.onNodeWithText("Expense (2)").assertExists()
        compose.onNodeWithText("Income (1)").assertExists()
    }

    @Test
    fun tappingAGroupOpensItAndTappingASubcategoryOpensItsActions() {
        val taps = show(CategoriesView(expanded = setOf(id(1))))
        // Tap the left end of the row, away from + Sub and the actions button that sit at its right.
        compose.onNodeWithText("Food").performTouchInput { click(centerLeft + Offset(8f, 0f)) }
        compose.onNodeWithText("Groceries").performClick()
        assertEquals(listOf("toggle:${id(1)}", "menu:Groceries"), taps.log)
    }

    @Test
    fun aGroupHasAnActionsButtonAndNothingElseBesideItsName() {
        val taps = show()
        compose.onNodeWithContentDescription("Actions for Food").performClick()
        compose.onNodeWithContentDescription("Actions for Old project").performClick()
        compose.onNodeWithText("+ Sub").assertDoesNotExist()
        assertEquals(listOf("menu:Food", "menu:Old project"), taps.log)
    }

    @Test
    fun aSearchOpensTheGroupsItFoundThingsIn() {
        show(CategoriesView(search = "gro"))
        compose.onNodeWithText("Groceries").assertExists()
    }

    @Test
    fun expandAllOpensEveryGroupAndTurnsIntoCollapseAll() {
        val taps = show()
        compose.onNodeWithText("Expand all").performClick()
        assertEquals(listOf("toggleAll:1"), taps.log)
    }

    @Test
    fun collapseAllShowsWhenEveryGroupIsOpenAndExpandAllIsLeftOutWhileSearching() {
        show(CategoriesView(expanded = setOf(id(1))))
        compose.onNodeWithText("Collapse all").assertExists()
        compose.onNodeWithText("Expand all").assertDoesNotExist()
    }

    @Test
    fun expandAllIsLeftOutWhileSearchingAndWhenNoGroupHasSubcategories() {
        show(CategoriesView(search = "food"))
        compose.onNodeWithText("Expand all").assertDoesNotExist()
        compose.onNodeWithText("Collapse all").assertDoesNotExist()
    }

    @Test
    fun theStatusChipsShowOnlyWhileSomethingIsArchived() {
        val none = listOf(food, groceries)
        show(shown = none)
        compose.onNodeWithText("Active").assertDoesNotExist()
        compose.onNodeWithText("All").assertDoesNotExist()
    }

    @Test
    fun theStatusChipsReportTheChoiceWhileSomethingIsArchived() {
        val taps = show()
        compose.onNodeWithText("Active").performClick()
        compose.onNodeWithText("All").assertIsSelected()
        assertEquals(listOf("status:Active"), taps.log)
    }

    @Test
    fun anEmptyLedgerAndAnEmptyFilterSayDifferentThings() {
        show(shown = emptyList(), groups = emptyList())
        compose.onNodeWithText("No categories yet.").assertExists()
        compose.onNodeWithContentDescription("Add category").assertExists()
    }

    @Test
    fun aSearchWithNoMatchIsNotTheEmptyLedger() {
        show(CategoriesView(search = "zzz"))
        compose.onNodeWithText("No matching categories.").assertExists()
        compose.onNodeWithText("No categories yet.").assertDoesNotExist()
    }

    @Test
    fun whileTheMirrorHasNoLedgerTheScreenSaysItIsOpening() {
        show(groups = null)
        compose.onNodeWithText("Opening your categories…").assertExists()
        compose.onNodeWithContentDescription("Add category").assertDoesNotExist()
    }

    @Test
    fun aNoticeIsShownInWords() {
        show(CategoriesView(notice = CategoryNotice.Archived))
        compose.onNodeWithText("Category archived.").assertExists()
    }

    @Test
    fun anErrorOutsideTheFormIsShownOnTheScreenAndAFormsOwnErrorStaysInItsSheet() {
        show(CategoriesView(error = CategoryError.Offline))
        compose.onNodeWithText("needs a connection", substring = true).assertExists()
    }

    @Test
    fun aFormsErrorIsShownOnceInItsSheetAndNotAlsoOnTheScreen() {
        show(CategoriesView(form = CategoryForm.forNew("expense").copy(name = "Pets"), error = CategoryError.Offline))
        compose.onAllNodesWithText("needs a connection", substring = true).assertCountEquals(1)
    }

    @Test
    fun aFormSheetIsShownWhileAFormIsOpen() {
        show(CategoriesView(form = CategoryForm.forNew("expense")))
        compose.onNodeWithText("New category").assertExists()
    }

    @Test
    fun anActionsSheetIsShownForTheChosenCategory() {
        show(CategoriesView(menu = groceries))
        compose.onNodeWithText("Edit category").assertExists()
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
            CategoryFormContent(form, emptyList(), false, false, shown, Taps().actions(form), Modifier.requiredHeight(3000.dp))
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

    /** The form's save button: the sheet's title says the same words, so the button is the one that can be clicked. */
    private fun saveButton(text: String) = compose.onNode(hasText(text) and hasClickAction())

    private fun showForm(form: CategoryForm, parents: List<CategoryRow> = emptyList(), hasSubcategories: Boolean = false, saving: Boolean = false, error: CategoryError? = null, taps: Taps = Taps()): Taps {
        compose.setContent { CategoryFormContent(form, parents, hasSubcategories, saving, error, taps.actions(form), Modifier.requiredHeight(3000.dp)) }
        return taps
    }

    @Test
    fun theAddFormStartsEmptyWithTheSaveButtonOff() {
        showForm(CategoryForm.forNew("expense"))
        compose.onNodeWithText("New category").assertExists()
        compose.onNodeWithText("Category name").assertExists()
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
    fun theKindCanBeChosenOnlyForANewCategoryAndChoosingItClearsTheParent() {
        val taps = showForm(CategoryForm.forNew("expense").copy(parentId = id(1)))
        compose.onNodeWithText("Income").performClick()
        assertEquals("income", taps.forms.single().kind)
        assertEquals(null, taps.forms.single().parentId)
    }

    @Test
    fun anEditFormShowsTheFixedKindAsAWordAndSavesWithChangesOnly() {
        showForm(CategoryForm.forEdit(groceries))
        compose.onNodeWithText("Edit category").assertExists()
        compose.onNodeWithText("Save changes").assertExists()
        compose.onNodeWithText("Expense").assertExists()
        compose.onNodeWithText("Income").assertDoesNotExist()
    }

    @Test
    fun aMainCategoryWithSubcategoriesCannotBeGivenAParent() {
        showForm(CategoryForm.forEdit(food), hasSubcategories = true)
        compose.onNodeWithContentDescription("Parent category").assertDoesNotExist()
        compose.onNodeWithText("Has subcategories", substring = true).assertExists()
    }

    @Test
    fun whileSavingTheFormSaysSoAndCannotBeSavedAgain() {
        showForm(CategoryForm.forNew("expense").copy(name = "Pets"), saving = true)
        compose.onNodeWithText("Saving…").assertIsNotEnabled()
    }

    @Test
    fun cancelClosesTheForm() {
        val taps = showForm(CategoryForm.forNew("expense"))
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(listOf("closeForm"), taps.log)
    }

    private fun showActions(row: CategoryRow, everything: List<CategoryRow> = items, taps: Taps = Taps()): Taps {
        compose.setContent { CategoryActionsContent(row, everything, taps.actions()) }
        return taps
    }

    @Test
    fun aGroupsActionsAreEditAddSubcategoryArchiveAndDelete() {
        val taps = showActions(row(9, "Pets"))
        compose.onNodeWithText("Pets").assertExists()
        compose.onNodeWithText("Edit category").performClick()
        compose.onNodeWithText("Add subcategory").performClick()
        compose.onNodeWithText("Archive category").performClick()
        compose.onNodeWithText("Delete category").performClick()
        assertEquals(listOf("edit:Pets", "addUnder:Pets", "ask:Pets", "askDelete:Pets"), taps.log)
    }

    @Test
    fun aSubcategoryAndAnArchivedGroupCannotHaveSubcategoriesAdded() {
        showActions(groceries)
        compose.onNodeWithText("Add subcategory").assertDoesNotExist()
    }

    @Test
    fun anArchivedGroupOffersNoNewSubcategory() {
        showActions(old)
        compose.onNodeWithText("Add subcategory").assertDoesNotExist()
    }

    @Test
    fun archiveIsBlockedWhileTheGroupHasActiveSubcategories() {
        val taps = showActions(food)
        compose.onNodeWithText("Archive active subcategories first").assertIsNotEnabled().performClick()
        assertEquals(emptyList<String>(), taps.log)
    }

    @Test
    fun anArchivedCategoryCanBeUnarchivedUnlessItsMainCategoryIsArchived() {
        val taps = showActions(old)
        compose.onNodeWithText("Unarchive category").assertIsEnabled().performClick()
        assertEquals(listOf("unarchive:Old project"), taps.log)
    }

    @Test
    fun aSubcategoryUnderAnArchivedMainCategoryExplainsWhyItCannotBeUnarchived() {
        val parent = row(10, "Parent", archived = true)
        val child = row(11, "Child", parentN = 10, archived = true)
        showActions(child, listOf(parent, child))
        compose.onNodeWithText("Unarchive the main category first").assertIsNotEnabled()
    }

    @Test
    fun deleteIsAlwaysThereEvenForAnArchivedCategoryAndAsksFirst() {
        showActions(old)
        compose.onNodeWithText("Delete category").assertIsEnabled()
    }

    @Test
    fun cancelClosesTheActionsSheet() {
        val taps = showActions(food)
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(listOf("closeMenu"), taps.log)
    }

    @Test
    fun theDeleteQuestionNamesTheCategoryMentionsNoUndoAndReportsTheAnswer() {
        val taps = show(CategoriesView(deleteAsk = DeleteAsk(groceries, block = null, canArchiveInstead = true)))
        compose.onNodeWithText("Delete category?").assertExists()
        compose.onNodeWithText("Delete Groceries? This category has no Undo; archive it to keep it instead.").assertExists()
        compose.onNodeWithText("Delete").performClick()
        assertEquals(listOf("confirmDelete"), taps.log)
    }

    @Test
    fun cancellingTheDeleteQuestionReportsIt() {
        val taps = show(CategoriesView(deleteAsk = DeleteAsk(groceries, block = null, canArchiveInstead = true)))
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(listOf("dismissDelete"), taps.log)
    }

    @Test
    fun aCategoryInUseCannotBeDeletedAndTheQuestionRecommendsArchiving() {
        val taps = show(CategoriesView(deleteAsk = DeleteAsk(groceries, DeleteBlock.UsedByEntries(3), canArchiveInstead = true)))
        compose.onNodeWithText("This category can't be deleted").assertExists()
        compose.onNodeWithText("Groceries is used by 3 entries", substring = true).assertExists()
        compose.onNodeWithText("Archive it to keep its history", substring = true).assertExists()
        compose.onNodeWithText("Delete").assertDoesNotExist()
        compose.onNodeWithText("Archive instead").performClick()
        assertEquals(listOf("archiveInstead"), taps.log)
    }

    @Test
    fun oneEntryIsSaidInTheSingular() {
        show(CategoriesView(deleteAsk = DeleteAsk(groceries, DeleteBlock.UsedByEntries(1), canArchiveInstead = true)))
        compose.onNodeWithText("Groceries is used by 1 entry,", substring = true).assertExists()
    }

    @Test
    fun theBlockedQuestionCanJustBeClosed() {
        val taps = show(CategoriesView(deleteAsk = DeleteAsk(groceries, DeleteBlock.UsedByEntries(2), canArchiveInstead = true)))
        compose.onNodeWithText("Close").performClick()
        assertEquals(listOf("dismissDelete"), taps.log)
    }

    @Test
    fun aMainCategoryWithSubcategoriesIsToldToDealWithThemFirstWithNoArchiveOffer() {
        val taps = show(CategoriesView(deleteAsk = DeleteAsk(food, DeleteBlock.HasSubcategories, canArchiveInstead = false)))
        compose.onNodeWithText("Food has subcategories. Delete or move them first, including archived ones.").assertExists()
        compose.onNodeWithText("Archive instead").assertDoesNotExist()
        compose.onNodeWithText("Close").performClick()
        assertEquals(listOf("dismissDelete"), taps.log)
    }

    @Test
    fun whenArchivingNeedsTheSubcategoriesArchivedFirstTheQuestionSaysSoInsteadOfOfferingIt() {
        show(CategoriesView(deleteAsk = DeleteAsk(food, DeleteBlock.UsedByEntries(4), canArchiveInstead = false)))
        compose.onNodeWithText("To archive it, archive its subcategories first.").assertExists()
        compose.onNodeWithText("Archive instead").assertDoesNotExist()
    }

    @Test
    fun anAlreadyArchivedCategoryInUseOffersNoArchiveAndNoFalseHint() {
        show(CategoriesView(deleteAsk = DeleteAsk(old, DeleteBlock.UsedByEntries(2), canArchiveInstead = false)))
        compose.onNodeWithText("To archive it, archive its subcategories first.").assertDoesNotExist()
        compose.onNodeWithText("Archive instead").assertDoesNotExist()
    }

    @Test
    fun aDeletedNoticeIsShown() {
        show(CategoriesView(notice = CategoryNotice.Deleted))
        compose.onNodeWithText("Category deleted.").assertExists()
    }

    @Test
    fun moreHasACategoriesCardThatOpensTheScreen() {
        val log = mutableListOf<String>()
        compose.setContent { MoreContent(MoreActions({}, {}, { log += "categories" }, {}), app.ledgerline.android.ui.more.MoreSummary(), 0.dp, Modifier.requiredHeight(3000.dp)) }
        compose.onNodeWithText("Categories").performClick()
        assertEquals(listOf("categories"), log)
    }
}
