package app.ledgerline.android.ui.design

import java.io.File
import org.junit.Assert.assertEquals
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
