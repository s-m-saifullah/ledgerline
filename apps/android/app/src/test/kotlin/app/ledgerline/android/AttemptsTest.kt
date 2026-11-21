package app.ledgerline.android

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** A step that is cancelled is not a step that failed (AND-P6). */
class AttemptsTest {
    @Test
    fun aBlockThatFinishesSucceeded() = runBlocking { assertTrue(succeeded { }) }

    @Test
    fun aBlockThatThrowsDidNotSucceed() = runBlocking {
        assertFalse(succeeded { error("refused") })
        assertFalse(succeeded { throw java.io.IOException("offline") })
    }

    @Test
    fun aCancellationPassesThroughInsteadOfBecomingAFailure() {
        val result = runCatching { runBlocking { succeeded { throw CancellationException("stop") } } }
        assertTrue(result.exceptionOrNull() is CancellationException)
    }

    @Test
    fun orNullGivesTheValueOrNullAndLetsACancellationPass() = runBlocking {
        assertEquals("kept", orNull { "kept" })
        assertEquals(null, orNull<String> { error("refused") })
        val result = runCatching { orNull<String> { throw CancellationException("stop") } }
        assertTrue(result.exceptionOrNull() is CancellationException)
    }

    @Test
    fun theEditorWritesThroughItAndNeverThroughRunCatching() {
        val text = File("src/main/kotlin/app/ledgerline/android/ui/editor/EditorViewModel.kt").readText()
        assertFalse("runCatching swallows a cancellation around a suspend write", Regex("""\brunCatching\b""").containsMatchIn(text))
        assertEquals("save and delete both use it", 2, Regex("""\bsucceeded \{""").findAll(text).count())
    }
}
