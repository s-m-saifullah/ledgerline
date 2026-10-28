package app.ledgerline.android.ui.editor

import app.ledgerline.android.ui.design.Choice
import android.app.Application
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

private val accounts = listOf(Choice("a1", "Checking", "USD"), Choice("a2", "Cash", "USD"))
private val categories = listOf(Choice("c1", "Food"), Choice("c2", "Food › Groceries"))
private val tags = listOf(Choice("t1", "work"), Choice("t2", "trip"), Choice("t3", "old", archived = true), Choice("t4", "home"))

private fun form(mode: EntryMode = EntryMode.Expense) = EditorForm(mode, "", "a1", null, "c1", "2026-10-23", "", "", emptyList())

private fun state(
    form: EditorForm = form(),
    isNew: Boolean = true,
    errors: Set<FormError> = emptySet(),
    readOnly: ReadOnly? = null,
    saving: Boolean = false,
    tags: List<Choice> = app.ledgerline.android.ui.editor.tags,
    toAccounts: List<Choice> = accounts.filter { it.id != form.accountId },
) = EditorState(
    isNew, form, if (isNew) EntryMode.entries else listOf(form.mode), accounts, toAccounts, categories, tags,
    readOnly = readOnly, canDelete = !isNew, errors = errors, saving = saving,
)

/** What the editor's controls report, as a log and the forms they asked for. */
private class Taps(val start: EditorForm = form()) {
    val log = mutableListOf<String>()
    val forms = mutableListOf<EditorForm>()

    /** The form as the screen would hold it: every update shows at once, as it does in the app. */
    var shown by mutableStateOf(start)

    fun actions() = EditorActions(
        update = { change -> shown = change(shown); forms += shown },
        save = { log += "save" },
        delete = { log += "delete" },
        close = { log += "close" },
        toggleNewCategory = { log += "toggleNew" },
        setNewCategoryName = { log += "name:$it" },
        createCategory = { log += "create" },
    )
}

/** The editor as plain data: what each form shows, what its controls report, and what its pickers offer. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class EditorContentTest {
    @get:Rule
    val compose = createComposeRule()

    private fun show(state: EditorState?, newCategory: NewCategory? = null, taps: Taps = Taps(state?.form ?: form())): Taps {
        compose.setContent {
            EditorContent(state?.copy(form = taps.shown), newCategory, app.ledgerline.android.R.string.editor_title_new, taps.actions(), Modifier.requiredHeight(3000.dp))
        }
        return taps
    }

    @Test
    fun anExpenseShowsPayeeAccountCategoryWhenTagsNoteAndPending() {
        show(state())
        for (label in listOf("Payee", "Account", "Category", "When", "Tags", "Note", "Pending")) compose.onNodeWithText(label).assertExists()
        compose.onNodeWithText("Checking").assertExists()
        compose.onNodeWithText("Food").assertExists()
    }

    @Test
    fun aTransferShowsFromAndToAndLeavesOutPayeeCategoryTagsAndPending() {
        show(state(form(EntryMode.Transfer).copy(toAccountId = "a2")))
        compose.onNodeWithText("From").assertExists()
        compose.onNodeWithText("To").assertExists()
        for (label in listOf("Payee", "Category", "Tags", "Pending", "Account")) compose.onNodeWithText(label).assertDoesNotExist()
        compose.onNodeWithText("When").assertExists()
        compose.onNodeWithText("Note").assertExists()
    }

    @Test
    fun theTypePillIsOnlyForANewEntry() {
        show(state())
        compose.onNodeWithText("Transfer").assertExists()
        compose.onNodeWithText("Income").assertExists()
    }

    @Test
    fun anExistingEntryHasNoTypePillBecauseItsKindIsFixedOnThePhone() {
        show(state(isNew = false))
        compose.onNodeWithText("Transfer").assertDoesNotExist()
    }

    @Test
    fun choosingATypeReportsTheMode() {
        val taps = show(state())
        compose.onNodeWithText("Income").performClick()
        compose.onNodeWithText("Transfer").performClick()
        assertEquals(listOf(EntryMode.Income, EntryMode.Transfer), taps.forms.map { it.mode })
    }

    @Test
    fun theAmountShowsItsCurrencyAndTypingReportsIt() {
        val taps = show(state())
        compose.onNodeWithText("USD").assertExists()
        compose.onNode(hasSetTextAction() and androidx.compose.ui.test.hasContentDescription("Amount")).performTextReplacement("12.5")
        assertEquals("12.5", taps.forms.single().amount)
    }

    @Test
    fun anAmountProblemIsSaidInWordsUnderTheAmount() {
        show(state(errors = setOf(FormError.AmountMissing)))
        compose.onNodeWithText("Enter an amount.").assertExists()
    }

    @Test
    fun everyRowSaysWhatIsMissing() {
        show(state(form().copy(accountId = null, categoryId = null), errors = setOf(FormError.AccountMissing, FormError.CategoryMissing)))
        compose.onNodeWithText("Choose an account.").assertExists()
        compose.onNodeWithText("Choose a category.").assertExists()
    }

    @Test
    fun aTransferSaysWhichAccountIsMissingOrTheSame() {
        show(state(form(EntryMode.Transfer), errors = setOf(FormError.ToAccountMissing)))
        compose.onNodeWithText("Choose the account the money goes to.").assertExists()
    }

    @Test
    fun aTransferWithNoOtherAccountInTheCurrencySaysSo() {
        show(state(form(EntryMode.Transfer), toAccounts = emptyList()))
        compose.onNodeWithText("No other account in this currency.").assertExists()
    }

    @Test
    fun payeeAndNoteReportWhatWasTyped() {
        val taps = show(state())
        compose.onNode(hasSetTextAction() and androidx.compose.ui.test.hasContentDescription("Payee")).performTextReplacement("Cafe")
        compose.onNode(hasSetTextAction() and androidx.compose.ui.test.hasContentDescription("Note")).performTextReplacement("lunch")
        assertEquals(listOf("Cafe", "lunch"), listOf(taps.forms.last().payee, taps.forms.last().note))
    }

    @Test
    fun pendingIsOffByDefaultAndTheSwitchReportsTheChoice() {
        val taps = show(state())
        compose.onNodeWithText("Not in your balance yet").assertExists()
        compose.onNode(androidx.compose.ui.test.isToggleable()).assertIsOff().performClick()
        assertEquals(true, taps.forms.single().pending)
    }

    @Test
    fun aPendingEntryShowsTheSwitchOnAndTurningItOffReportsCleared() {
        val taps = show(state(form().copy(pending = true), isNew = false))
        compose.onNode(androidx.compose.ui.test.isToggleable()).assertIsOn().performClick()
        assertEquals(false, taps.forms.single().pending)
    }

    @Test
    fun theSwapExchangesFromAndToAndIsOffUntilBothAreChosen() {
        val taps = show(state(form(EntryMode.Transfer).copy(toAccountId = "a2")))
        compose.onNodeWithContentDescription("Swap accounts").assertIsEnabled().performClick()
        assertEquals("a2" to "a1", taps.forms.single().accountId to taps.forms.single().toAccountId)
    }

    @Test
    fun theSwapIsOffWithoutATo() {
        show(state(form(EntryMode.Transfer)))
        compose.onNodeWithContentDescription("Swap accounts").assertIsNotEnabled()
    }

    @Test
    fun theDateAndTheOptionalTimeAreShownAndTheCrossClearsTheTime() {
        val taps = show(state(form().copy(time = "21:10")))
        compose.onNode(hasText("9:10 PM") or hasText("21:10")).assertExists()
        compose.onNodeWithContentDescription("Clear time").performClick()
        assertEquals(null, taps.forms.single().time)
        compose.onNodeWithText("+ Add time").assertExists()
    }

    @Test
    fun withoutATimeThePillOffersToAddOne() {
        show(state())
        compose.onNodeWithText("+ Add time").assertExists()
        compose.onNodeWithContentDescription("Clear time").assertDoesNotExist()
    }

    @Test
    fun theAccountPickerOffersTheAccountsAndChoosingOneReportsIt() {
        val taps = show(state())
        compose.onNodeWithText("Account").performClick()
        compose.onNodeWithText("Cash").performClick()
        assertEquals("a2", taps.forms.single().accountId)
    }

    @Test
    fun theCategoryPickerOffersNewCategoryAtTheEnd() {
        val taps = show(state())
        compose.onNodeWithText("Category").performClick()
        compose.onNodeWithText("Food › Groceries").assertExists()
        compose.onNodeWithText("New category").performClick()
        assertEquals(listOf("toggleNew"), taps.log)
    }

    @Test
    fun theCategoryPickerClosesOnceACategoryIsChosenOrMade() {
        val taps = show(state())
        compose.onNodeWithText("Category").performClick()
        compose.onNodeWithText("New category").assertExists()
        // A category made in the picker is chosen for the entry, which also closes the picker.
        compose.runOnIdle { taps.shown = taps.shown.copy(categoryId = "c2") }
        compose.waitForIdle()
        compose.onNodeWithText("New category").assertDoesNotExist()
    }

    @Test
    fun withTheNewCategoryBoxOpenThePickerShowsItsNameBoxInsteadOfTheList() {
        show(state(), NewCategory("Pets"))
        compose.onNodeWithText("Category").performClick()
        compose.onNodeWithText("New category name").assertExists()
        compose.onNodeWithText("Food › Groceries").assertDoesNotExist()
    }

    @Test
    fun tagsShowAChipPerChosenTagAndARemoveTapReportsIt() {
        val taps = show(state(form().copy(tagIds = listOf("t1", "t3")), tags = tags))
        compose.onNodeWithText("work").assertExists()
        compose.onNodeWithText("old (archived)").assertExists()
        compose.onNodeWithContentDescription("Remove tag work").performClick()
        assertEquals(listOf("t3"), taps.forms.single().tagIds)
    }

    @Test
    fun thePlusTagPickerOffersOnlyTagsNotChosenAndNotArchived() {
        val taps = show(state(form().copy(tagIds = listOf("t1")), tags = tags))
        compose.onNodeWithText("+ Tag").performClick()
        compose.onNodeWithText("trip").assertExists()
        compose.onNodeWithText("home").assertExists()
        compose.onNodeWithText("old").assertDoesNotExist()
        compose.onAllNodesWithText("work").assertCountEquals(1)
        compose.onNodeWithText("trip").performClick()
        assertEquals(listOf("t1", "t2"), taps.forms.single().tagIds)
    }

    @Test
    fun thereIsNoPlusTagWhenEveryTagIsChosenOrOnlyArchivedOnesAreLeft() {
        show(state(form().copy(tagIds = listOf("t1")), tags = listOf(Choice("t1", "work"))))
        compose.onNodeWithText("+ Tag").assertDoesNotExist()
    }

    @Test
    fun anArchivedTagAloneDoesNotOfferPlusTag() {
        show(state(form().copy(tagIds = listOf("t1")), tags = listOf(Choice("t1", "work"), Choice("t3", "old", archived = true))))
        compose.onNodeWithText("+ Tag").assertDoesNotExist()
    }

    @Test
    fun tenTagsIsTheMostAndThePlusTagIsReplacedByTheWords() {
        val many = (1..11).map { Choice("t$it", "tag$it") }
        show(state(form().copy(tagIds = many.take(MaxTagsPerEntry).map { it.id }), tags = many))
        compose.onNodeWithText("+ Tag").assertDoesNotExist()
        compose.onNodeWithText("Ten tags is the most").assertExists()
    }

    @Test
    fun withNoTagsAtAllThereIsNoTagsRow() {
        show(state(tags = emptyList()))
        compose.onNodeWithText("Tags").assertDoesNotExist()
    }

    @Test
    fun saveCancelAndTheSavingStateReport() {
        val taps = show(state())
        compose.onNode(hasText("Save") and hasClickAction()).performClick()
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(listOf("save", "close"), taps.log)
    }

    @Test
    fun whileSavingTheSaveButtonIsOff() {
        show(state(saving = true))
        compose.onNode(hasText("Save") and hasClickAction()).assertIsNotEnabled()
    }

    @Test
    fun aSaveThatFailedSaysSo() {
        show(state(errors = setOf(FormError.CouldNotSave)))
        compose.onNodeWithText("This could not be saved. Try again.").assertExists()
    }

    @Test
    fun theTrashIsOnlyForAnEntryThatExistsAndAsksFirst() {
        show(state())
        compose.onNodeWithContentDescription("Delete").assertDoesNotExist()
    }

    @Test
    fun deletingAnExistingEntryAsksAndReportsTheAnswer() {
        val taps = show(state(isNew = false))
        compose.onNodeWithContentDescription("Delete").performClick()
        compose.onNodeWithText("Delete this entry?").assertExists()
        assertEquals(emptyList<String>(), taps.log)
        compose.onNode(hasText("Delete") and hasClickAction()).performClick()
        assertEquals(listOf("delete"), taps.log)
    }

    @Test
    fun deletingATransferSaysTransfer() {
        show(state(form(EntryMode.Transfer).copy(toAccountId = "a2"), isNew = false))
        compose.onNodeWithContentDescription("Delete").performClick()
        compose.onNodeWithText("Delete this transfer?").assertExists()
    }

    @Test
    fun aReadOnlyEntryShowsTheReasonAndBackAndNoFormOrSave() {
        val taps = show(state(isNew = false, readOnly = ReadOnly.Split))
        compose.onNodeWithText("Split entries are edited in the web app.").assertExists()
        compose.onNodeWithText("Payee").assertDoesNotExist()
        compose.onNode(hasText("Save") and hasClickAction()).assertDoesNotExist()
        compose.onNodeWithContentDescription("Delete").assertDoesNotExist()
        compose.onNodeWithText("Back").performClick()
        assertEquals(listOf("close"), taps.log)
    }

    @Test
    fun whileLoadingNothingIsShownButTheTopBar() {
        val taps = show(null)
        compose.onNodeWithText("Payee").assertDoesNotExist()
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(listOf("close"), taps.log)
    }

    @Test
    fun theCardsSitOnTheScreenMarginsLikeTheTypePillAndTheAmount() {
        show(state())
        val row = compose.onNode(hasText("Account") and hasClickAction()).getUnclippedBoundsInRoot()
        val root = compose.onRoot().getUnclippedBoundsInRoot()
        assertEquals(16f, row.left.value, 0.5f)
        assertEquals(root.right.value - 16f, row.right.value, 0.5f)
    }
}
