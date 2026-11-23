package app.ledgerline.android.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The shared-pieces rules of WP-20, read from the sources so a later change cannot undo them without a test saying so:
 * every write goes through the one set of write helpers, a typed amount's problem is worked out once, the base currency
 * is named once, and the pieces nothing used are gone.
 */
class ComposeWriteHelpersScanTest {
    private val main = File("src/main/kotlin/app/ledgerline/android")
    private val sources = main.walkTopDown().filter { it.extension == "kt" }.toList()

    private fun text(path: String) = File(main, path).readText()

    private fun count(pattern: String) = sources.sumOf { Regex(pattern).findAll(it.readText()).count() }

    @Test
    fun theSourcesAreFound() {
        assertTrue(sources.size > 100)
    }

    @Test
    fun categoriesAndTheEditorUseTheSharedWriteError() {
        assertEquals("a second copy of WriteError", 0, count("""\bCategoryError\b|\btoCategoryError\b"""))
    }

    @Test
    fun categoriesAndTheEditorKeepTheirKeysWithWriteKeys() {
        listOf("ui/categories/CategoriesViewModel.kt", "ui/editor/EditorViewModel.kt").forEach { path ->
            val source = text(path)
            assertFalse("$path makes its own keys", Regex("""Uuid7\.next""").containsMatchIn(source))
            assertTrue("$path uses WriteKeys", Regex("""WriteKeys\("cat"\)""").containsMatchIn(source))
        }
    }

    @Test
    fun aStaleAnswerIsRecognisedInOnePlace() {
        assertEquals("the 409/404 test is written once", 1, count("""== 409"""))
        assertTrue(Regex("""\.isStale\(\)""").containsMatchIn(text("ui/categories/CategoriesViewModel.kt")))
    }

    @Test
    fun theFlowsAViewModelExposesCannotBeWrittenByTheScreen() {
        assertTrue(Regex("""val view: StateFlow<CategoriesView> = _view\.asStateFlow\(\)""").containsMatchIn(text("ui/categories/CategoriesViewModel.kt")))
        assertTrue(Regex("""val limit: StateFlow<LimitUi\?> = _limit\.asStateFlow\(\)""").containsMatchIn(text("ui/budgets/BudgetsViewModel.kt")))
    }

    @Test
    fun noFormWritesTheFiveWaySwitchOverATypedAmount() {
        assertEquals("only AmountIssue.kt turns an AmountInput into an issue", 1, count("""AmountInput\.TooPrecise ->"""))
        assertTrue(text("ui/editor/AmountIssue.kt").contains("AmountInput.TooPrecise ->"))
    }

    @Test
    fun theBaseCurrencyIsNamedOnce() {
        assertEquals("a literal \"USD\" outside BaseCurrency", 1, count(""""USD""""))
        assertTrue(text("ui/clients/CrossCurrency.kt").contains("const val BaseCurrency = \"USD\""))
    }

    @Test
    fun aTypedDecimalIsReadByOneFunction() {
        assertEquals(1, count("""startsWith\("\."\)"""))
    }

    @Test
    fun whatNothingUsedIsGoneAndTheDocumentedOptionStays() {
        assertEquals(0, count("""\bfun formatMoment\b|\bMutedLine\b"""))
        assertEquals("narrowingRoom is the documented alternative to a fixed header", 1, count("""fun LazyListScope\.narrowingRoom\b"""))
    }
}
