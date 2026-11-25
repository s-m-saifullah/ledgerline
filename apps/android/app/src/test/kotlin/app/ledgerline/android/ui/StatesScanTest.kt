package app.ledgerline.android.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The state and summary rules of WP-22c, read from the sources: a read in progress is one `LoadingNote`, an empty list is an
 * `EmptyState`, the Clients and Loans summaries are one shared figure, and every icon button is a 48 dp target.
 */
class StatesScanTest {
    private val main = File("src/main/kotlin/app/ledgerline/android")
    private val sources = main.walkTopDown().filter { it.extension == "kt" }.toList()
    private fun relative(file: File) = file.relativeTo(main).path.replace('\\', '/')
    private fun offenders(pattern: String, allowed: Set<String> = emptySet()) = sources
        .filter { relative(it) !in allowed && Regex(pattern).containsMatchIn(it.readText()) }
        .map { relative(it) }

    @Test
    fun theSourcesAreFound() {
        assertTrue(sources.size > 100)
    }

    @Test
    fun noLoadingLineIsWrittenByHandInACard() {
        assertEquals(emptyList<String>(), offenders("""LedgerCard \{\s*Muted\("""))
    }

    @Test
    fun aLoadingTextIsAlwaysALoadingNote() {
        // The line inside a service row, while its payments load, is part of that row, not a screen's state.
        val inARow = setOf("ui/clients/ClientRows.kt")
        val loose = sources.filter { relative(it) !in inARow }.flatMap { file ->
            Regex("""(.{0,40})R\.string\.(\w*_loading\w*|mirror_waiting|categories_opening)""").findAll(file.readText())
                .filter { !it.groupValues[1].endsWith("LoadingNote(stringResource(") }
                .map { relative(file) + ": " + it.groupValues[2] }.toList()
        }
        assertEquals(emptyList<String>(), loose)
    }

    @Test
    fun theTransactionsAndInsightsEmptyStatesAreEmptyStates() {
        val transactions = File(main, "ui/home/TransactionsContent.kt").readText()
        assertTrue(Regex("""EmptyState\(stringResource\(R\.string\.entries_empty\)""").containsMatchIn(transactions))
        assertTrue(Regex("""EmptyState\(stringResource\(R\.string\.entries_no_match_title\)""").containsMatchIn(transactions))
        val insights = File(main, "ui/insights/InsightsContent.kt").readText()
        assertTrue(Regex("""EmptyState\(stringResource\(R\.string\.insights_no_spending""").containsMatchIn(insights))
    }

    @Test
    fun theClientsAndLoansSummariesShareOneFigure() {
        assertTrue("Clients uses SummaryFigure", File(main, "ui/clients/ClientsContent.kt").readText().contains("SummaryFigure("))
        assertTrue("Loans uses SummaryFigure", File(main, "ui/loans/LoansContent.kt").readText().contains("SummaryFigure("))
        assertEquals("a summary label is not upper-cased by a screen", emptyList<String>(), offenders("""label\.uppercase\(\)"""))
        assertEquals("a check mark written into a sentence", emptyList<String>(), offenders("✓"))
        assertTrue(!File("src/main/res/values/strings.xml").readText().contains("✓"))
    }

    @Test
    fun everyIconButtonIsA48DpTarget() {
        val bare = sources.flatMap { file ->
            Regex("""IconButton\(([^\n]*)""").findAll(file.readText()).filter { !it.groupValues[1].contains("TouchTarget") && !it.groupValues[1].contains("sized") }
                .map { relative(file) + ": " + it.value.take(70) }.toList()
        }
        assertEquals(emptyList<String>(), bare)
    }
}
