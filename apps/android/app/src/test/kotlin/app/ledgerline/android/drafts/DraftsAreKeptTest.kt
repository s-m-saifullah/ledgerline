package app.ledgerline.android.drafts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * What a person types in a money sheet or the editor survives Android ending the app (WP-18b). The rule is read from the
 * sources, so a new sheet that forgets it fails here: every view model that holds a sheet keeps its draft and its retry keys,
 * and a write's key is never made without a place to keep it.
 */
class DraftsAreKeptTest {
    private val main = File("src/main/kotlin/app/ledgerline/android")
    private val sources = main.walkTopDown().filter { it.extension == "kt" }.toList()

    private fun text(path: String) = File(main, path).readText()

    private val sheets = listOf(
        "ui/clients/RecordPaymentViewModel.kt",
        "ui/clients/RecordReceiptViewModel.kt",
        "ui/clients/LogServiceViewModel.kt",
        "ui/loans/RecordLoanViewModel.kt",
    )

    @Test
    fun theSourcesAreFound() {
        assertTrue(sources.size > 100)
        sheets.forEach { assertTrue(it, File(main, it).exists()) }
    }

    @Test
    fun everySheetKeepsItsDraftAndItsKeys() {
        sheets.forEach { path ->
            val source = text(path)
            assertTrue("$path takes the saved state", Regex("""saved: SavedStateHandle = SavedStateHandle\(\)""").containsMatchIn(source))
            assertTrue("$path keeps its form in step", Regex("""\bkeepDraft\(draft, sheet\)""").containsMatchIn(source))
            assertTrue("$path brings the draft back", Regex("""restored\?\.let \{ viewModelScope\.launch \{ restore\(it\) \} \}""").containsMatchIn(source))
            assertTrue("$path keeps the keys of its writes", Regex("""WriteKeys\("\w+", keysDraft\(saved\)\)""").containsMatchIn(source))
            assertTrue("$path never shows another ledger's draft", Regex("""if \(ledger != kept\.ledgerId\) \{\s+keys\.clear\(\)\s+return""").containsMatchIn(source))
        }
    }

    @Test
    fun noWriteKeysAreMadeWithoutAPlaceToKeepThem() {
        // Not covered yet (not part of WP-18b): the delete-service question, which has no typed text, and the Budgets limit sheet.
        val notYet = setOf("WriteKeys.kt", "DeleteServiceViewModel.kt", "BudgetsViewModel.kt")
        val bare = sources.filter { it.name !in notYet && Regex("""WriteKeys\("\w+"\)""").containsMatchIn(it.readText()) }.map { it.name }
        assertEquals("a screen whose keys would be lost with the app", emptyList<String>(), bare)
    }

    @Test
    fun theEditorKeepsTheFormOfItsOpeningAndForgetsItWhenLeft() {
        val model = text("ui/editor/EditorViewModel.kt")
        assertTrue(Regex("""saved: SavedStateHandle = SavedStateHandle\(\)""").containsMatchIn(model))
        assertTrue("saved on every change", Regex("""draft\.save\(EditorDraft\(shown\.session, ledgerId, shown\.form\)\)""").containsMatchIn(model))
        assertTrue("only the same opening on the same ledger gets it back", Regex("""it\.session == session && it\.ledgerId == ledgerId""").containsMatchIn(model))
        assertTrue("a finished save keeps nothing", Regex("""shown\.done -> draft\.save\(null\)""").containsMatchIn(model))
        val screen = text("ui/editor/EditorScreen.kt")
        assertTrue("leaving the editor forgets it", Regex("""OnLeaving \{ viewModel\.leave\(\) \}""").containsMatchIn(screen))
    }

    @Test
    fun theClientAndPersonBeingLookedAtAreKept() {
        listOf("ui/clients/ClientsViewModel.kt", "ui/loans/LoansViewModel.kt").forEach { path ->
            val source = text(path)
            assertTrue("$path reads the kept selection", Regex("""MutableStateFlow\(saved\.get<String>\(SelectedKey\)\)""").containsMatchIn(source))
            assertTrue("$path keeps the selection", Regex("""_selected\.collect""").containsMatchIn(source))
        }
    }
}
