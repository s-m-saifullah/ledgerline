package app.ledgerline.android.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The privacy rules of WP-22d (SEC-7), read from the sources: a question shows the amount the owner just typed in full
 * even with Hide amounts on (`typedMoney`), nothing else does, and a sentence that stays masked is read with its spoken
 * form, not the dots.
 */
class PrivacyScanTest {
    private val main = File("src/main/kotlin/app/ledgerline/android")
    private val sources = main.walkTopDown().filter { it.extension == "kt" }.toList()
    private fun relative(file: File) = file.relativeTo(main).path.replace('\\', '/')

    /** The functions named `...Question` in [text]: from the `fun` line to the closing brace in the first column. */
    private fun questionFunctions(text: String): List<String> =
        Regex("""(?m)^(?:private |internal )?fun (\w*Question)\(.*?^\}""", RegexOption.DOT_MATCHES_ALL).findAll(text).map { it.value }.toList()

    @Test
    fun theSourcesAreFound() {
        assertTrue(sources.size > 100)
        assertTrue(questionFunctions(File(main, "ui/loans/LoanSheet.kt").readText()).isNotEmpty())
    }

    @Test
    fun aQuestionNeverMasksWhatWasTyped() {
        val masked = sources.flatMap { file -> questionFunctions(file.readText()).filter { it.contains("money(") }.map { relative(file) } }
        assertEquals(emptyList<String>(), masked)
    }

    @Test
    fun thePaymentReceiptAndLoanQuestionsShowTheTypedAmount() {
        listOf("ui/clients/PaymentSheet.kt", "ui/clients/ReceiptSheet.kt", "ui/loans/LoanSheet.kt").forEach { path ->
            val questions = questionFunctions(File(main, path).readText())
            assertTrue("$path has a question that uses typedMoney", questions.any { it.contains("typedMoney(") })
        }
    }

    @Test
    fun typedMoneyIsOnlyForQuestions() {
        val outside = sources.filter { relative(it) != "ui/privacy/Privacy.kt" }.filter { file ->
            val text = file.readText()
            questionFunctions(text).fold(text) { rest, question -> rest.replace(question, "") }.contains("typedMoney(")
        }.map { relative(it) }
        assertEquals(emptyList<String>(), outside)
    }

    /** The sentences of the sheets that hold a masked amount and are read on their own. */
    private val sentences = listOf(
        "payment_tip_note", "receipt_over", "receipt_left", "service_hourly_result", "service_error_below_received",
        "payment_rate_about", "limit_context",
    )

    @Test
    fun everyMaskedSentenceHasItsSpokenForm() {
        val missing = sources.flatMap { file ->
            val lines = file.readLines()
            sentences.mapNotNull { id ->
                val uses = lines.filter { Regex("""R\.string\.$id\b""").containsMatchIn(it) }
                val masked = uses.count { Regex("""\.text\b(?!\()""").containsMatchIn(it) }
                val spoken = uses.count { it.contains(".spoken") }
                if (masked != spoken) "${relative(file)}: $id has $masked masked and $spoken spoken" else null
            }
        }
        assertEquals(emptyList<String>(), missing)
    }

    @Test
    fun theSentencesAreStillWrittenSomewhere() {
        sentences.forEach { id ->
            assertTrue("$id is used", sources.any { it.readText().contains("R.string.$id") })
        }
    }
}
