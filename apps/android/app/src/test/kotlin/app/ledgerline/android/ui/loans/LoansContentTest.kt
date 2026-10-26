package app.ledgerline.android.ui.loans

import android.app.Application
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import app.ledgerline.android.mirror.EntryLine
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.Paged
import app.ledgerline.android.ui.clients.contact
import app.ledgerline.android.ui.clients.homeLoans
import app.ledgerline.android.ui.clients.loan
import app.ledgerline.android.ui.clients.movement
import app.ledgerline.android.ui.clients.person
import app.ledgerline.android.ui.privacy.LocalPrivacy
import app.ledgerline.api.HomeLoans
import app.ledgerline.api.LoanBalance
import app.ledgerline.api.LoanPerson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Loans (ADR 0046): a summary card and the people with chips and a search when there are enough; a person with their history. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class LoansContentTest {
    @get:Rule
    val compose = createComposeRule()

    private class Taps {
        val opened = mutableListOf<String>()
        val filters = mutableListOf<LoanFilter>()
        var back = 0
        var more = 0
    }

    private val sam = person("Sam Rivera", "USD" to 20000L)
    private val jo = person("Jo Chen", "USD" to -15000L)
    private val casey = person("Casey Morgan")
    private val alex = person("Alex Settled", "USD" to 0L)
    private val old = person("Old Friend", "USD" to 300L, archived = true)

    private fun list(
        rows: List<LoanPerson> = listOf(sam, jo, casey, alex),
        filter: LoanFilter = LoanFilter.Active,
        text: String = "",
        totals: Online<HomeLoans> = Online.Ready(homeLoans(20000, 15000)),
        taps: Taps = Taps(),
        hasMore: Boolean = false,
        private: Boolean = false,
        state: Online<Paged<LoanPerson>> = Online.Ready(Paged(rows, hasMore = hasMore)),
    ) = compose.setContent {
        CompositionLocalProvider(LocalPrivacy provides private) {
            LoansListContent(
                totals, text, filter, state,
                LoansListActions({ taps.back++ }, {}, { taps.filters += it }, { taps.opened += it }, { taps.more++ }, {}),
                Modifier.requiredHeight(3000.dp),
            )
        }
    }

    private fun count(text: String, n: Int) = compose.onAllNodesWithText(text).assertCountEquals(n)

    @Test
    fun theTopBarHasTheTitleAndABackArrow() {
        val taps = Taps()
        list(taps = taps)
        compose.onNodeWithText("Loans").assertExists()
        compose.onNodeWithContentDescription("Back").performClick()
        assertEquals(1, taps.back)
    }

    @Test
    fun theOldHeaderIsGone() {
        list()
        compose.onNodeWithText("Money you lend and borrow").assertDoesNotExist()
        compose.onNodeWithText("Owed back to you").assertDoesNotExist()
        compose.onNodeWithText("Money you borrowed").assertDoesNotExist()
    }

    @Test
    fun theSummaryCardShowsWhatIsLentOutAndWhatIsOwed() {
        list()
        compose.onNodeWithText("Lent out", ignoreCase = true).assertExists()
        // Each amount is in the card and in the row of the person it is lent to or borrowed from.
        count("$200.00", 2)
        // The card's label and Jo's row both say "You owe".
        compose.onAllNodesWithText("You owe", ignoreCase = true).assertCountEquals(2)
        count("$150.00", 2)
    }

    @Test
    fun theSummarySaysHowManyPeopleOweYouAndHowManyYouOwe() {
        list()
        compose.onNodeWithText("1 person owes you").assertExists()
        compose.onNodeWithText("You owe 1 person").assertExists()
    }

    @Test
    fun withNothingBorrowedTheSummarySaysDebtFree() {
        list(totals = Online.Ready(homeLoans(20000, 0)))
        compose.onNodeWithText("✓ Debt-free").assertExists()
    }

    @Test
    fun withoutTheTotalsThereIsNoSummaryCard() {
        list(totals = Online.Loading)
        compose.onNodeWithText("Lent out", ignoreCase = true).assertDoesNotExist()
    }

    @Test
    fun aRowHasTheNameOneWordAndTheAmount() {
        list()
        compose.onNode(hasText("Sam Rivera") and hasText("Owes you") and hasText("$200.00")).assertExists()
        compose.onNode(hasText("Jo Chen") and hasText("You owe") and hasText("$150.00")).assertExists()
        compose.onNode(hasText("Casey Morgan") and hasText("No loans yet")).assertExists()
        compose.onNode(hasText("Alex Settled") and hasText("Settled")).assertExists()
    }

    @Test
    fun aSettledPersonAndOneWithoutALoanShowNoAmount() {
        list(rows = listOf(casey, alex))
        compose.onNodeWithText("$0.00").assertDoesNotExist()
    }

    @Test
    fun aPersonOwingInOneCurrencyAndOwedInAnotherKeepsEachSign() {
        list(rows = listOf(person("Mixed", "USD" to 2000L, "EUR" to -500L)))
        compose.onNodeWithText("Owes you and you owe").assertExists()
        compose.onNodeWithText("+$20.00").assertExists()
        compose.onNodeWithText("-€5.00").assertExists()
    }

    @Test
    fun theBiggestLoanIsFirst() {
        list()
        val sam = compose.onNodeWithText("Sam Rivera").getBoundsInRoot().top
        val jo = compose.onNodeWithText("Jo Chen").getBoundsInRoot().top
        assertTrue("$sam $jo", sam < jo)
    }

    @Test
    fun noSearchWithSevenPeople() {
        list(rows = List(7) { person("Person $it") })
        compose.onNodeWithContentDescription("Search people").assertDoesNotExist()
    }

    @Test
    fun theSearchAppearsWithEightPeople() {
        list(rows = List(8) { person("Person $it") })
        compose.onNodeWithContentDescription("Search people").assertExists()
    }

    @Test
    fun theSearchStaysWhenAWordLeavesOneOrNoPerson() {
        list(rows = List(8) { person("Person $it") }, text = "zzz")
        compose.onNodeWithContentDescription("Search people").assertExists()
        compose.onNodeWithText("No matching people").assertExists()
    }

    @Test
    fun aSearchNarrowsTheList() {
        list(rows = List(8) { person("Person $it") } + sam, text = "sam")
        compose.onNodeWithText("Sam Rivera").assertExists()
        compose.onNodeWithText("Person 1").assertDoesNotExist()
    }

    @Test
    fun noChipsWhenNobodyIsArchived() {
        list()
        compose.onNodeWithText("Archived").assertDoesNotExist()
    }

    @Test
    fun theChipsAppearWhenSomeoneIsArchivedAndSelectTheirFilter() {
        val taps = Taps()
        list(rows = listOf(sam, old), taps = taps)
        compose.onNodeWithText("Archived").performClick()
        compose.onNodeWithText("All").performClick()
        compose.onNodeWithText("Active").performClick()
        assertEquals(listOf(LoanFilter.Archived, LoanFilter.All, LoanFilter.Active), taps.filters)
    }

    @Test
    fun activeLeavesOutTheArchivedAndArchivedShowsThemMarked() {
        list(rows = listOf(sam, old))
        compose.onNodeWithText("Old Friend (archived)").assertDoesNotExist()
    }

    @Test
    fun archivedShowsOnlyThoseWhoAre() {
        list(rows = listOf(sam, old), filter = LoanFilter.Archived)
        compose.onNodeWithText("Old Friend (archived)").assertExists()
        compose.onNodeWithText("Sam Rivera").assertDoesNotExist()
    }

    @Test
    fun noArchivedPeopleIsSaidOnTheArchivedChipWhenAllAreActive() {
        list(rows = listOf(sam, old.copy(archivedAt = null)), filter = LoanFilter.Archived)
        // No archived person: the chips are hidden and Active shows.
        compose.onNodeWithText("Sam Rivera").assertExists()
    }

    @Test
    fun noPeopleAtAllSaysSo() {
        list(rows = emptyList())
        compose.onNodeWithText("No loans yet. Add them in the web app.").assertExists()
    }

    @Test
    fun tappingARowOpensThatPerson() {
        val taps = Taps()
        list(taps = taps)
        compose.onNodeWithText("Sam Rivera").performClick()
        assertEquals(listOf("sam-rivera"), taps.opened)
    }

    @Test
    fun loadMoreShowsOnlyWhileThereIsMore() {
        val taps = Taps()
        list(taps = taps, hasMore = true)
        compose.onNodeWithText("Load more people").performClick()
        assertEquals(1, taps.more)
    }

    @Test
    fun theListHidesEveryAmountInPrivacyMode() {
        list(private = true)
        for (text in listOf("$200.00", "$150.00")) compose.onNodeWithText(text, substring = true).assertDoesNotExist()
    }

    // One person.

    private fun showPerson(
        loans: Online<List<LoanBalance>> = Online.Ready(listOf(loan("USD", 20000, opening = 5000))),
        movements: List<EntryLine> = emptyList(),
        private: Boolean = false,
        name: String = "Sam Rivera",
        back: IntArray = IntArray(1),
    ) = compose.setContent {
        CompositionLocalProvider(LocalPrivacy provides private) {
            PersonContent(
                Online.Ready(contact(name, origin = "loan")), loans, movements,
                PersonActions({ back[0]++ }, {}, {}),
                Modifier.requiredHeight(3000.dp),
            )
        }
    }

    @Test
    fun aPersonsTopBarHasTheirNameAndABackArrow() {
        val back = IntArray(1)
        showPerson(back = back)
        compose.onNodeWithText("Sam Rivera").assertExists()
        compose.onNodeWithContentDescription("Back").performClick()
        assertEquals(1, back[0])
    }

    @Test
    fun theBalanceCardSaysWhatTheyOweYouLarge() {
        showPerson()
        compose.onNodeWithText("Owes you").assertExists()
        compose.onNodeWithText("$200.00").assertExists()
    }

    @Test
    fun aDebtIsSaidAsYouOwe() {
        showPerson(loans = Online.Ready(listOf(loan("USD", -15000))))
        compose.onNodeWithText("You owe").assertExists()
        compose.onNodeWithText("$150.00").assertExists()
    }

    @Test
    fun theBalanceIsShownOncePerCurrencyWithASettledOneNamed() {
        showPerson(loans = Online.Ready(listOf(loan("USD", 20000), loan("EUR", -4000), loan("GBP", 0))))
        compose.onNodeWithText("$200.00").assertExists()
        compose.onNodeWithText("€40.00").assertExists()
        compose.onNodeWithText("Settled (GBP)").assertExists()
    }

    @Test
    fun noLoansSaysNothingLentOrBorrowed() {
        showPerson(loans = Online.Ready(emptyList()))
        compose.onNodeWithText("Nothing lent or borrowed yet.").assertExists()
        compose.onNodeWithText("History", ignoreCase = true).assertDoesNotExist()
    }

    @Test
    fun theOpeningBalanceIsTheLastLineOfTheHistory() {
        showPerson(movements = listOf(movement("m", "2026-10-20", 2500, payee = "Birthday dinner")))
        compose.onNodeWithText("History", ignoreCase = true).assertExists()
        val moved = compose.onNodeWithText("Sent").getBoundsInRoot().top
        val opening = compose.onNodeWithText("Opening balance").getBoundsInRoot().top
        assertTrue("$moved $opening", moved < opening)
        compose.onNodeWithText("Before Ledgerline").assertExists()
        compose.onNodeWithText("+$50.00").assertExists()
    }

    @Test
    fun anOpeningBalanceYouOwedIsNegative() {
        showPerson(loans = Online.Ready(listOf(loan("USD", -15000, opening = -5000))))
        compose.onNodeWithText("-$50.00").assertExists()
    }

    @Test
    fun noOpeningLineWithoutABalanceFromBefore() {
        showPerson(loans = Online.Ready(listOf(loan("USD", 20000))))
        compose.onNodeWithText("Opening balance").assertDoesNotExist()
        compose.onNodeWithText("History", ignoreCase = true).assertDoesNotExist()
    }

    @Test
    fun aMoveOutIsSentAndAMoveInIsReceivedWithWhoAndWhen() {
        showPerson(
            loans = Online.Ready(listOf(loan("USD", 20000))),
            movements = listOf(movement("a", "2026-10-20", 2500, payee = "Birthday dinner"), movement("b", "2026-10-02", -1000, note = "Flights")),
        )
        compose.onNodeWithText("Sent").assertExists()
        compose.onNodeWithText("Birthday dinner · Oct 20, 2026").assertExists()
        compose.onNodeWithText("+$25.00").assertExists()
        compose.onNodeWithText("Received").assertExists()
        compose.onNodeWithText("Flights · Oct 2, 2026").assertExists()
        compose.onNodeWithText("-$10.00").assertExists()
    }

    @Test
    fun movesStillShowWhenTheBalanceCouldNotBeRead() {
        showPerson(loans = Online.Offline, movements = listOf(movement("a", "2026-10-20", 2500)))
        compose.onNodeWithText("Sent").assertExists()
        compose.onNodeWithText("Opening balance").assertDoesNotExist()
    }

    @Test
    fun aPersonScreenHidesEveryAmountInPrivacyMode() {
        showPerson(
            private = true,
            loans = Online.Ready(listOf(loan("USD", 20000, opening = 5000))),
            movements = listOf(movement("a", "2026-10-20", 2500), movement("b", "2026-10-02", -1000)),
        )
        for (text in listOf("$200.00", "$50.00", "$25.00", "$10.00")) compose.onNodeWithText(text, substring = true).assertDoesNotExist()
    }

    // The colour of what is owed to you.

    private val accent = Color(0xFF123456)

    private fun textColor(text: String): Color {
        val node = compose.onNodeWithText(text).fetchSemanticsNode()
        val results = mutableListOf<TextLayoutResult>()
        node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(results)
        return results.first().layoutInput.style.color
    }

    @Test
    fun anAmountOwedToYouIsInTheAccentColourInTheList() {
        compose.setContent {
            MaterialTheme(colorScheme = lightColorScheme(primary = accent)) {
                LoansListContent(
                    Online.Ready(homeLoans(7700, 5500)), "", LoanFilter.Active,
                    Online.Ready(Paged(listOf(person("Owed Person", "USD" to 7700L), person("Owing Person", "USD" to -5500L)), hasMore = false)),
                    LoansListActions({}, {}, {}, {}, {}, {}), Modifier.requiredHeight(3000.dp),
                )
            }
        }
        // Read each amount's own text, not the row's merged one (whose first text is the initials).
        fun colors(text: String) = compose.onAllNodesWithText(text, useUnmergedTree = true).fetchSemanticsNodes().map { node ->
            val results = mutableListOf<TextLayoutResult>()
            node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(results)
            results.first().layoutInput.style.color
        }
        // $77.00 is in the card (not in the accent) and in the row owed to you (in the accent); $55.00 is a debt: never in it.
        val owed = colors("$77.00")
        assertEquals(owed.toString(), 2, owed.size)
        assertTrue(owed.toString(), accent in owed)
        val owing = colors("$55.00")
        assertEquals(owing.toString(), 2, owing.size)
        assertTrue(owing.toString(), accent !in owing)
    }

    @Test
    fun anAmountOwedToYouIsInTheAccentColourOnThePersonsScreenAndADebtIsNot() {
        compose.setContent {
            MaterialTheme(colorScheme = lightColorScheme(primary = accent)) {
                PersonContent(
                    Online.Ready(contact("Sam", origin = "loan")), Online.Ready(listOf(loan("USD", 7700), loan("EUR", -5500))), emptyList(),
                    PersonActions({}, {}, {}), Modifier.requiredHeight(3000.dp),
                )
            }
        }
        assertEquals(accent, textColor("$77.00"))
        assertTrue(textColor("€55.00") != accent)
    }
}
