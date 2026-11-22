package app.ledgerline.android.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The cheap-by-default rules of WP-19b, read from the sources so a later change cannot undo them without a test saying so:
 * one HTTP client, the update manager built off the main thread, shared sync state seen by every thread, and no screen that
 * reads again for a counter it has already read for.
 */
class SyncCostsScanTest {
    private val main = File("src/main/kotlin/app/ledgerline/android")
    private val sources = main.walkTopDown().filter { it.extension == "kt" }.toList()

    private fun text(path: String) = File(main, path).readText()

    @Test
    fun theSourcesAreFound() {
        assertTrue(sources.size > 100)
    }

    @Test
    fun onlyTheModuleBuildsAnHttpClientAndTheProviderOnlyForATest() {
        val builders = sources.filter { Regex("""\bOkHttpClient\(\)""").containsMatchIn(it.readText()) }.map { it.name }.sorted()
        assertEquals(listOf("ClientsProvider.kt", "HttpModule.kt"), builders)
        // ...and the provider's own is only the default a test gets; every client it makes is built from the one it was given.
        val provider = text("session/ClientsProvider.kt")
        assertEquals(3, Regex("""base = base,""").findAll(provider).count())
    }

    @Test
    fun theUpdateCheckUsesTheSharedClient() {
        val module = text("update/UpdateModule.kt")
        assertTrue(Regex("""http: OkHttpClient""").containsMatchIn(module))
        assertTrue(Regex("""GithubUpdateSource\(http,""").containsMatchIn(module))
    }

    @Test
    fun theAppBuildsAndStartsTheUpdateManagerOffTheMainThread() {
        val app = text("LedgerlineApp.kt")
        assertTrue("the manager is injected lazily", Regex("""dagger\.Lazy<UpdateManager>""").containsMatchIn(app))
        assertTrue("and started inside the background scope", Regex("""background\.launch \{ update\.get\(\)\.start\(background\) \}""").containsMatchIn(app))
    }

    @Test
    fun theSyncStateThatSeveralThreadsTouchIsVolatile() {
        val coordinator = text("sync/SyncCoordinator.kt")
        listOf("previous", "needsFullRefresh", "lastPullAt").forEach { name ->
            assertTrue("$name is volatile", Regex("""@Volatile private var $name\b""").containsMatchIn(coordinator))
        }
    }

    @Test
    fun noScreenReadsAgainBecauseACounterIsAboveZero() {
        // That re-fired every time the screen came back, for a count it had already read for.
        val screens = listOf("ui/clients/ClientsScreen.kt", "ui/loans/LoansScreen.kt")
        screens.forEach { path ->
            val source = text(path)
            assertTrue("$path reads again for a count above zero", !Regex("""> 0\) model\.retry\(\)""").containsMatchIn(source))
            assertTrue("$path asks the view model whether the count is news", Regex("""model\.rereadFor\(""").containsMatchIn(source))
        }
        assertEquals(4, Regex("""model\.rereadFor\(""").findAll(text("ui/clients/ClientsScreen.kt")).count())
    }
}
