package app.ledgerline.android.ui.design

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The pieces every screen shares (WP-16): a screen asks `ui/design` for a field or a switch row instead of building its own,
 * so a change is made once. Each rule reads the sources, as `TextFloorTest` does.
 */
class SharedPiecesTest {
    private val ui = File("src/main/kotlin/app/ledgerline/android/ui")
    private val sources = ui.walkTopDown().filter { it.extension == "kt" }.toList()

    private fun outside(allowed: String, pattern: Regex): List<String> =
        sources.filter { it.name != allowed && pattern.containsMatchIn(it.readText()) }.map { it.name }

    @Test
    fun theSourcesAreFound() {
        assertTrue("no sources under $ui", sources.size > 50)
    }

    @Test
    fun onlyLedgerFieldCallsMaterialsOutlinedTextField() {
        assertEquals(emptyList<String>(), outside("Fields.kt", Regex("""\bOutlinedTextField\(""")))
    }

    @Test
    fun ledgerFieldIsTheTwelveDpFieldShape() {
        val text = File(ui, "design/Fields.kt").readText()
        assertEquals("both overloads draw the field shape", 2, Regex("""shape = MaterialTheme\.shapes\.small""").findAll(text).count())
    }

    @Test
    fun aSwitchRowIsTheSharedOneAndNoScreenBuildsItsOwn() {
        val own = sources.filter { it.name != "Pieces.kt" && Regex("""role = Role\.Switch""").containsMatchIn(it.readText()) }.map { it.name }
        assertEquals("a screen that makes its own switch row", emptyList<String>(), own)
        assertEquals(emptyList<String>(), outside("Pieces.kt", Regex("""\bfun \w*SwitchRow\(""")))
    }

    @Test
    fun onlyQuestionOpensADialog() {
        assertEquals(emptyList<String>(), outside("Question.kt", Regex("""\b(AlertDialog|BasicAlertDialog)\(""")))
    }

    @Test
    fun noScreenKeepsItsOwnCancelOrCloseWord() {
        // One "Cancel" and one "Close" for every question and sheet; a screen's own copy of the word drifts.
        val strings = File("src/main/res/values/strings.xml").readText()
        fun copies(word: String) = Regex("""<string name="(\w*${word.lowercase()})">$word</string>""").findAll(strings).map { it.groupValues[1] }.toList()
        assertEquals(listOf("cancel"), copies("Cancel"))
        assertEquals(listOf("close"), copies("Close"))
    }

    @Test
    fun everyQuestionThatDeletesIsRed() {
        // The confirming button of a delete is the red filled one (ADR 0054: red for destructive actions); a third action that throws away unsent changes is the red outline.
        fun src(path: String) = File(ui, path).readText()
        listOf("categories/CategoriesContent.kt", "budgets/BudgetLimitSheet.kt", "clients/DeleteServiceQuestion.kt", "editor/EditorContent.kt").forEach { path ->
            assertTrue("$path asks before deleting but is not danger", Regex("""danger = true,""").containsMatchIn(src(path)))
        }
        assertEquals("the category delete question and no other in that file is red", 1, Regex("""danger = true,""").findAll(src("categories/CategoriesContent.kt")).count())
        assertTrue(Regex("""QuestionAction\([^\n]*danger = true""").containsMatchIn(src("home/Attention.kt")))
        // The questions that only confirm are not red.
        listOf("clients/PaymentSheet.kt", "clients/ReceiptSheet.kt", "loans/LoanSheet.kt").forEach { path ->
            assertFalse("$path is red but does not delete", Regex("""danger = true""").containsMatchIn(src(path)))
        }
    }

    @Test
    fun onlyLedgerSheetOpensASheetAndWritesTheSheetCorners() {
        assertEquals(emptyList<String>(), outside("Sheets.kt", Regex("""\bModalBottomSheet\(""")))
        assertEquals(emptyList<String>(), outside("Sheets.kt", Regex("""topStart = 24\.dp""")))
    }

    @Test
    fun oneSheetTitleAndOneFoldRowAndOneActionsSheet() {
        assertEquals(emptyList<String>(), outside("Pieces.kt", Regex("""\bfun (FoldRow|SheetTitle)\(""")))
        assertEquals(emptyList<String>(), outside("Sheets.kt", Regex("""\bfun (ActionsSheet|ActionsContent|ActionsButton)\(""")))
        // A Cancel link beside a title is SheetTitle's; the entry editor's own top row (a centered title and a trash icon) is the one other.
        val own = sources.filter { it.name !in setOf("Pieces.kt", "EditorContent.kt") && Regex("""LinkButton\(stringResource\(R\.string\.cancel\)""").containsMatchIn(it.readText()) }.map { it.name }
        assertEquals(emptyList<String>(), own)
    }

    @Test
    fun theTwoPillShapesAreTheOnlyOnes() {
        // A status pill is 8 dp and a chip you tap is 18 dp; nothing else draws a pill of its own.
        assertEquals(emptyList<String>(), outside("Pieces.kt", Regex("""RoundedCornerShape\(18\.dp\)""")))
        assertEquals(emptyList<String>(), sources.filter { Regex("""RoundedCornerShape\(percent = 50\)""").containsMatchIn(it.readText()) }.map { it.name })
        mapOf(
            "home/TransactionsContent.kt" to """Surface\(shape = PillShape""",
            "settings/SettingsScreen.kt" to """border\(1\.dp, palette\.border, PillShape\)""",
            "home/MonthCard.kt" to """shape = PillShape,""",
        ).forEach { (path, use) -> assertTrue("$path draws its pill without PillShape", Regex(use).containsMatchIn(File(ui, path).readText())) }
        assertTrue("the editor's chips do not use ChipShape", Regex("""background\(palette\.accentSoft, ChipShape\)""").containsMatchIn(File(ui, "editor/EditorContent.kt").readText()))
    }

    @Test
    fun theSheetIsFullHeightFromTheStartWithTheSheetShapeAndSurfaceColor() {
        val text = File(ui, "design/Sheets.kt").readText()
        assertTrue(text.contains("skipPartiallyExpanded = true"))
        assertTrue(text.contains("shape = SheetShape"))
        assertTrue(text.contains("containerColor = MaterialTheme.colorScheme.surface"))
    }

    @Test
    fun deletingACategoryIsTheRedChoiceOfItsActionsSheet() {
        assertTrue(Regex("""SheetAction\(delete, \{ actions\.askDelete\(row\) \}, danger = true\)""").containsMatchIn(File(ui, "categories/CategorySheets.kt").readText()))
    }

    @Test
    fun noScreenBuildsItsOwnTopBarOrButtonOrDatePicker() {
        assertEquals(emptyList<String>(), outside("Design.kt", Regex("""\bOutlinedButton\(""")))
        assertEquals(emptyList<String>(), sources.filter { Regex("""\bTopAppBar\(""").containsMatchIn(it.readText()) }.map { it.name })
        assertEquals(emptyList<String>(), outside("SignedInScreen.kt", Regex("""\bScaffold\(""")))
        assertEquals(emptyList<String>(), outside("Values.kt", Regex("""\b(DatePickerDialog|DatePicker)\(""")))
        assertEquals(emptyList<String>(), outside("Values.kt", Regex("""\bfun (ValuePill|DatePickerStep)\(""")))
    }

    @Test
    fun theFiltersSheetAppliesAtOnceWithNoDraftAndNoApplyButton() {
        val text = File(ui, "home/EntryFilterPanel.kt").readText()
        assertFalse("a draft is held", Regex("""\bdraft\b""").containsMatchIn(text))
        assertFalse("an Apply button", text.contains("filters_apply"))
        assertFalse("a Cancel button", Regex("""R\.string\.cancel""").containsMatchIn(text))
        assertTrue(Regex("""cancelLabel = stringResource\(R\.string\.close\)""").containsMatchIn(text))
    }

    @Test
    fun discardingAChangeIsRedAndAsksFirst() {
        val text = File(ui, "home/Attention.kt").readText()
        assertTrue(Regex("""SecondaryButton\(stringResource\(R\.string\.attention_discard\)[^\n]*danger = true""").containsMatchIn(text))
        assertTrue("the button opens the question, it does not discard", Regex("""\{ onAskDiscard\(item\.id\) \}""").containsMatchIn(text))
        assertFalse("the button discards without asking", Regex("""R\.string\.attention_discard\)[^\n]*actions\.onDiscard""").containsMatchIn(text))
        assertTrue(Regex("""danger = true,\s*\) \{ Text\(stringResource\(R\.string\.attention_discard_body\)\)""").containsMatchIn(text))
    }

    @Test
    fun aScreenReadsATextStyleAndNeverWritesASizeOfItsOwn() {
        // Sizes belong to the theme (TypeScaleTest holds the scale); a letter spacing may be written, a font size may not.
        val sizes = sources.filter { "/theme/" !in it.path }.flatMap { file ->
            file.readLines().withIndex()
                .filter { (_, line) -> "letterSpacing" !in line && Regex("""\b\d+(\.\d+)?\.sp\b""").containsMatchIn(line) }
                .map { (n, _) -> "${file.name}:${n + 1}" }
        }
        assertEquals("a size written in a screen", emptyList<String>(), sizes)
    }

    @Test
    fun aScreenClosesItsSheetsWhenLeftThroughOnLeavingNeverOnEveryDisposal() {
        // A raw DisposableEffect also runs when the activity is recreated, which shut an open sheet and threw away its keys (AND-P4).
        assertEquals(emptyList<String>(), outside("Leaving.kt", Regex("""\bDisposableEffect\(""")))
        listOf("clients/ClientsScreen.kt", "loans/LoansScreen.kt").forEach { path ->
            val text = File(ui, path).readText()
            assertTrue("$path does not close its sheets through OnLeaving", Regex("""\bOnLeaving \{""").containsMatchIn(text))
        }
    }
}
