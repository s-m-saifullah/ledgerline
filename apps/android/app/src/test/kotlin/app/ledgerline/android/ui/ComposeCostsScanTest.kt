package app.ledgerline.android.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The cheap-by-default rules of WP-19c, read from the sources so a later change cannot undo them without a test saying so:
 * a screen stops listening to a flow when it is in the background, the day groups are worked out once per list, and the
 * amount and rate patterns are compiled once.
 */
class ComposeCostsScanTest {
    private val main = File("src/main/kotlin/app/ledgerline/android")
    private val sources = main.walkTopDown().filter { it.extension == "kt" }.toList()

    private fun text(path: String) = File(main, path).readText()

    @Test
    fun theSourcesAreFound() {
        assertTrue(sources.size > 100)
    }

    @Test
    fun noScreenKeepsListeningToAFlowInTheBackground() {
        val offenders = sources.filter { Regex("""\bcollectAsState\s*\(""").containsMatchIn(it.readText()) }.map { it.name }
        assertEquals("these still use collectAsState()", emptyList<String>(), offenders)
        val lifecycleAware = sources.sumOf { Regex("""\bcollectAsStateWithLifecycle\(""").findAll(it.readText()).count() }
        assertTrue("the 73 collections moved over, not deleted ($lifecycleAware found)", lifecycleAware >= 73)
    }

    @Test
    fun theDayGroupsAreWorkedOutOncePerListNotOnEveryDraw() {
        val source = text("ui/home/TransactionsContent.kt")
        assertEquals("groupDays is called once", 1, Regex("""\bgroupDays\(""").findAll(source).count())
        assertTrue("and inside remember, keyed by the list", Regex("""remember\(entries\) \{ if \(entries is Mirrored\.Ready\) groupDays\(entries\.items\)""").containsMatchIn(source))
        assertTrue("and the list draws from it", Regex("""\bdays\.forEach \{""").containsMatchIn(source))
    }

    @Test
    fun theAmountAndRatePatternsAreCompiledOnce() {
        listOf("ui/editor/Amounts.kt", "ui/editor/Rates.kt").forEach { path ->
            val lines = text(path).lines()
            val inside = lines.filter { "Regex(" in it && !it.startsWith("private val ") }
            assertEquals("$path compiles a pattern inside a function", emptyList<String>(), inside)
        }
        assertTrue(text("ui/editor/Amounts.kt").lines().any { it.startsWith("private val ") && "Regex(" in it })
    }
}
