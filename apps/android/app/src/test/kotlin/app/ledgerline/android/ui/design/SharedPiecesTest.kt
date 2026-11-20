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
    fun noScreenKeepsItsOwnCancelWord() {
        // One "Cancel" for every question and sheet; a screen's own copy of the word drifts.
        val strings = File("src/main/res/values/strings.xml").readText()
        val cancels = Regex("""<string name="(\w*cancel)">Cancel</string>""").findAll(strings).map { it.groupValues[1] }.toList()
        assertEquals(listOf("cancel"), cancels)
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
    fun aScreenReadsATextStyleAndNeverWritesASizeOfItsOwn() {
        // Sizes belong to the theme (TypeScaleTest holds the scale); a letter spacing may be written, a font size may not.
        val sizes = sources.filter { "/theme/" !in it.path }.flatMap { file ->
            file.readLines().withIndex()
                .filter { (_, line) -> "letterSpacing" !in line && Regex("""\b\d+(\.\d+)?\.sp\b""").containsMatchIn(line) }
                .map { (n, _) -> "${file.name}:${n + 1}" }
        }
        assertEquals("a size written in a screen", emptyList<String>(), sizes)
    }
}
