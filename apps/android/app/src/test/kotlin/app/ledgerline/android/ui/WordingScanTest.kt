package app.ledgerline.android.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The wording rules of WP-22a, read from `strings.xml` so a later string cannot undo them without a test saying so: one
 * word for the thing ("transaction", as the web), "Couldn't" never "Could not", one set of sentences for the ways a write
 * can end, "on the web" for what the phone leaves to the web, and a question mark on every question.
 */
class WordingScanTest {
    private val xml = File("src/main/res/values/strings.xml").readText()

    /** Every <string> and <item> text with the name of the resource it belongs to; markup and escapes are left as written. */
    private val texts: List<Pair<String, String>> = run {
        val found = mutableListOf<Pair<String, String>>()
        Regex("""<(string|plurals) name="([^"]+)"[^>]*>(.*?)</\1>""", RegexOption.DOT_MATCHES_ALL).findAll(xml).forEach { block ->
            val name = block.groupValues[2]
            if (block.groupValues[1] == "string") found += name to block.groupValues[3]
            else Regex("""<item[^>]*>(.*?)</item>""", RegexOption.DOT_MATCHES_ALL).findAll(block.groupValues[3]).forEach { found += name to it.groupValues[1] }
        }
        found
    }

    private val names = Regex("""<(?:string|plurals) name="([^"]+)"""").findAll(xml).map { it.groupValues[1] }.toList()

    private fun offenders(pattern: Regex) = texts.filter { pattern.containsMatchIn(it.second) }.map { it.first }

    @Test
    fun theStringsAreRead() {
        assertTrue(texts.size > 500)
    }

    @Test
    fun theWordIsTransactionNotEntry() {
        assertEquals(emptyList<String>(), offenders(Regex("""\b[Ee]ntr(y|ies)\b""")))
    }

    @Test
    fun itIsCouldntNeverCouldNot() {
        assertEquals(emptyList<String>(), offenders(Regex("""\b[Cc]ould not\b""")))
    }

    @Test
    fun whatTheWebDoesIsSaidAsOnTheWeb() {
        assertEquals(emptyList<String>(), offenders(Regex("""\bin the web app\b""", RegexOption.IGNORE_CASE)))
        listOf("signin_notice_server_not_reached", "signin_notice_key_lost").forEach { name ->
            assertTrue("$name says it is on the web", texts.first { it.first == name }.second.contains("on the web"))
        }
    }

    @Test
    fun everyQuestionTitleEndsInAQuestionMark() {
        val question = Regex(""".*(_ask_title|_delete_title|_remove_title|_discard_title|_archive_title|_delete_entry_title|_delete_transfer_title)(_.*)?""")
        val titles = texts.filter { question.matches(it.first) }
        assertTrue("the question titles were not found", titles.size >= 8)
        assertEquals(emptyList<String>(), titles.filterNot { it.second.trimEnd().endsWith("?") }.map { it.first })
    }

    @Test
    fun everyWriteSaysItsFailuresWithTheSharedSentences() {
        // One set of sentences for a write that could not be done; only "Your account can't …" belongs to a screen.
        val own = Regex("""(category|limit|loan|payment|service|service_delete)_error_(offline|failed|rejected)""")
        assertEquals(emptyList<String>(), names.filter { own.matches(it) })
        listOf("write_error_offline", "write_error_offline_kept", "write_error_failed", "write_error_failed_delete", "write_error_rejected").forEach {
            assertTrue("$it is missing", it in names)
        }
        assertEquals("Needs a connection. What you entered is kept.", texts.first { it.first == "write_error_offline_kept" }.second)
        assertEquals("Couldn\\'t save this. Try again.", texts.first { it.first == "write_error_failed" }.second)
        assertEquals("The server didn\\'t accept this.", texts.first { it.first == "write_error_rejected" }.second)
    }

    @Test
    fun aSentenceHasOneResourceNotTwo() {
        listOf("service_paid_in_full", "receipt_paid_full", "updates_try_again").forEach { assertTrue("$it is a copy", it !in names) }
        assertTrue("paid_in_full" in names)
        assertTrue("try_again" in names)
    }

    @Test
    fun theSettingsHintsSayWhatTheWebSays() {
        assertEquals("Hides every amount on screen", texts.first { it.first == "privacy_mode_detail" }.second)
        assertEquals("1, 2, 3 reads 1.23", texts.first { it.first == "cents_first_detail" }.second)
    }

    @Test
    fun theThingsAreCalledWhatTheWebCallsThem() {
        assertEquals("Add transaction", texts.first { it.first == "editor_title_new" }.second)
        assertEquals("Edit transaction", texts.first { it.first == "editor_title_entry" }.second)
        assertEquals("Owes you", texts.first { it.first == "client_open_balance" }.second)
        assertEquals("Updates and about", texts.first { it.first == "settings_about" }.second)
    }
}
