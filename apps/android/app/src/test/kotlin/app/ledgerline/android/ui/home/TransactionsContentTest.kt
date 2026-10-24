package app.ledgerline.android.ui.home

import android.app.Application
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import app.ledgerline.android.mirror.EntryFilters
import app.ledgerline.android.mirror.EntryLine
import app.ledgerline.android.overlay.ShownLine
import app.ledgerline.android.ui.privacy.LocalPrivacy
import app.ledgerline.android.ui.theme.LedgerlineTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** What the Transactions list shows (ADR 0046). A plain Application, as the other Compose tests. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class TransactionsContentTest {
    @get:Rule
    val compose = createComposeRule()

    private fun entry(id: String, amount: Long, payee: String?, kind: String = "expense", status: String = "cleared", transferId: String? = null, account: String = "Checking", tags: String? = null) =
        EntryLine(id, "2026-10-22", null, kind, false, status, amount, "USD", payee, account, "Food", tags, transferId, "2026-10-22T10:00:00Z")

    private val opened = mutableListOf<String>()

    private fun show(
        lines: List<ShownLine>,
        filters: EntryFilters = EntryFilters(),
        status: SyncStatus = quietSync,
        hidden: Boolean = false,
        onAttention: () -> Unit = {},
        onFilters: (EntryFilters) -> Unit = {},
    ) = compose.setContent {
        LedgerlineTheme {
            CompositionLocalProvider(LocalPrivacy provides hidden) {
                TransactionsContent(
                    status, Mirrored.Ready(lines), false, {}, filters, FilterOptions(), false, {}, onFilters, {}, onAttention,
                    onOpen = { opened += it.id }, modifier = Modifier.requiredHeight(4000.dp),
                )
            }
        }
    }

    private val transfer = listOf(
        ShownLine(entry("out", -4800, null, "transfer", transferId = "t1"), unsent = false),
        ShownLine(entry("in", 4800, null, "transfer", transferId = "t1", account = "Cash"), unsent = false),
    )

    @Test
    fun aTransferIsOneRowFromAccountToAccountThatOpensItsEditor() {
        show(transfer)
        compose.onNodeWithContentDescription("Checking → Cash, \$48.00, Transfer, Thu, Oct 22, 2026").performClick()
        assertEquals(listOf("out"), opened)
    }

    @Test
    fun anEntryShowsItsPayeeCategoryAccountAndAmountAndOpens() {
        show(listOf(ShownLine(entry("e1", -1771, "Circle K", account = "Amex"), unsent = false)))
        compose.onNodeWithContentDescription("Circle K, -\$17.71, Expense, Food · Amex, Thu, Oct 22, 2026").performClick()
        assertEquals(listOf("e1"), opened)
    }

    @Test
    fun aNotSentEntryAndAPendingOneSayTheirFlagInPlaceOfTheKind() {
        show(listOf(ShownLine(entry("a", -100, "Unsent"), unsent = true), ShownLine(entry("b", -200, "Waiting", status = "pending"), unsent = false)))
        compose.onNodeWithContentDescription("Unsent, -\$1.00, Not sent yet", substring = true).assertExists()
        compose.onNodeWithContentDescription("Waiting, -\$2.00, Pending", substring = true).assertExists()
    }

    @Test
    fun aTransferWithAnUnsentLegIsNotSentYet() {
        show(listOf(ShownLine(transfer[0].line, unsent = true), transfer[1]))
        compose.onNodeWithContentDescription("Checking → Cash, \$48.00, Not sent yet", substring = true).assertExists()
    }

    @Test
    fun theDaysHeadingCarriesItsNet() {
        show(listOf(ShownLine(entry("a", -1771, "A"), false), ShownLine(entry("b", 5000, "B", "income"), false)))
        compose.onNodeWithText("Thu, Oct 22, 2026").assertExists()
        compose.onNodeWithText("+\$32.29").assertExists()
    }

    @Test
    fun privacyModeHidesTheDaysNetAndEveryAmountOfATransfer() {
        show(listOf(ShownLine(entry("a", -1771, "A"), false)) + transfer, hidden = true)
        compose.onNodeWithText("\$17.71", substring = true).assertDoesNotExist()
        compose.onNodeWithText("-\$17.71", substring = true).assertDoesNotExist()
        compose.onNodeWithContentDescription("48.00", substring = true).assertDoesNotExist()
    }

    @Test
    fun whatNeedsTheOwnerIsOneLineThatOpensIt() {
        var attention = 0
        show(emptyList(), status = SyncStatus(quietSync.line, unsent = 0, attention = 2), onAttention = { attention++ })
        compose.onNodeWithText("2 changes need your attention").performClick()
        assertEquals(1, attention)
    }

    @Test
    fun anEmptyMatchOffersToClearTheFilters() {
        val changed = mutableListOf<EntryFilters>()
        show(emptyList(), filters = EntryFilters(text = "zzz"), onFilters = { changed += it })
        compose.onNodeWithText("Clear filters").performClick()
        assertEquals(EntryFilters(), changed.single())
    }

    @Test
    fun aTransferWhoseOtherLegIsUnsentIsNotSentYetToo() {
        show(listOf(transfer[0], ShownLine(transfer[1].line, unsent = true)))
        compose.onNodeWithContentDescription("Checking → Cash, \$48.00, Not sent yet", substring = true).assertExists()
    }

    @Test
    fun aPendingLegMakesTheTransferPending() {
        show(listOf(transfer[0], ShownLine(entry("in", 4800, null, "transfer", status = "pending", transferId = "t1", account = "Cash"), false)))
        compose.onNodeWithContentDescription("Checking → Cash, \$48.00, Pending", substring = true).assertExists()
    }

    @Test
    fun nothingNeedingTheOwnerMeansNoLineAboutIt() {
        show(emptyList(), status = SyncStatus(quietSync.line, unsent = 0, attention = 0))
        compose.onNodeWithText("attention", substring = true).assertDoesNotExist()
    }

    @Test
    fun incomeAndAPositiveDayCarryAPlusAndAnExpenseDoesNot() {
        show(listOf(ShownLine(entry("a", -1771, "Circle K"), false), ShownLine(entry("b", 5000, "Payroll", "income"), false)))
        compose.onNodeWithContentDescription("Payroll, \$50.00, Income", substring = true).assertExists()
        // The row's amount and the day's net (\$32.29) carry the plus; the expense's does not.
        compose.onNodeWithText("+\$50.00", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("+\$32.29", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("-\$17.71", useUnmergedTree = true).assertExists()
    }

    @Test
    fun aDayThatCameOutBehindShowsItsMinusAndNoPlus() {
        show(listOf(ShownLine(entry("a", -1771, "Circle K"), false)))
        // The heading's net and the row's amount.
        assertEquals(2, compose.onAllNodesWithText("-\$17.71", useUnmergedTree = true).fetchSemanticsNodes().size)
        compose.onNodeWithText("+", substring = true, useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun aTransferHasNoPlus() {
        show(transfer)
        compose.onNodeWithText("+", substring = true, useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun aLoneTransferLegHasNoPlusEither() {
        show(listOf(transfer[1]))
        compose.onNodeWithText("+", substring = true, useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun aHiddenAmountKeepsItsMaskWithoutAPlus() {
        assertEquals("•••••", app.ledgerline.android.ui.privacy.ShownMoney("•••••", "Amount hidden").withPlus(5000).text)
        assertEquals("+\$5.00", app.ledgerline.android.ui.privacy.ShownMoney("\$5.00", "\$5.00").withPlus(500).text)
        assertEquals("\$0.00", app.ledgerline.android.ui.privacy.ShownMoney("\$0.00", "\$0.00").withPlus(0).text)
        assertEquals("-\$5.00", app.ledgerline.android.ui.privacy.ShownMoney("-\$5.00", "-\$5.00").withPlus(-500).text)
    }

    @Test
    fun theSyncLineIsSilentWhileEverythingIsInOrder() {
        show(emptyList(), status = quietSync)
        compose.onNodeWithText("Updated", substring = true).assertDoesNotExist()
    }

    @Test
    fun theSyncLineSpeaksWhenThereIsSomethingToSay() {
        assertEquals(false, syncNeedsSaying(quietSync))
        assertEquals(true, syncNeedsSaying(quietSync.copy(unsent = 1)))
        assertEquals(true, syncNeedsSaying(quietSync.copy(line = quietSync.line.copy(running = true))))
        assertEquals(true, syncNeedsSaying(quietSync.copy(line = quietSync.line.copy(problem = SyncProblem.Offline))))
        show(emptyList(), status = quietSync.copy(unsent = 2))
        compose.onNodeWithText("2 changes not sent yet", substring = true).assertExists()
    }
}
