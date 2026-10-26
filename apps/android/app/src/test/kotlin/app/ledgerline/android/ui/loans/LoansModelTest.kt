package app.ledgerline.android.ui.loans

import app.ledgerline.android.ui.clients.movement
import app.ledgerline.android.ui.clients.person
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LoansModelTest {
    private val sam = person("Sam", "USD" to 20000L)
    private val jo = person("Jo", "USD" to -50000L)
    private val casey = person("Casey")
    private val settled = person("Alex", "USD" to 0L)
    private val old = person("Old Friend", "USD" to 300L, archived = true)
    private val all = listOf(sam, jo, casey, settled, old)

    @Test
    fun activeShowsPeopleWhoAreNotArchived() {
        assertEquals(listOf("Jo", "Sam", "Alex", "Casey"), visiblePeople(all, LoanFilter.Active, "").map { it.name })
    }

    @Test
    fun archivedShowsOnlyThoseWhoAre() {
        assertEquals(listOf("Old Friend"), visiblePeople(all, LoanFilter.Archived, "").map { it.name })
    }

    @Test
    fun allShowsEveryone() {
        assertEquals(5, visiblePeople(all, LoanFilter.All, "").size)
    }

    @Test
    fun theBiggestLoanIsFirstWhicheverWayItGoesThenSettledPeopleByName() {
        assertEquals(listOf("Jo", "Sam"), visiblePeople(all, LoanFilter.Active, "").map { it.name }.take(2))
        assertEquals(listOf("Alex", "Casey"), visiblePeople(all, LoanFilter.Active, "").map { it.name }.drop(2))
    }

    @Test
    fun theBiggestAmountInAnyCurrencyOrdersAPerson() {
        val mixed = person("Mixed", "USD" to 100L, "EUR" to -90000L)
        assertEquals("Mixed", visiblePeople(listOf(sam, mixed), LoanFilter.All, "").first().name)
    }

    @Test
    fun theOrderIgnoresCapitalLettersForPeopleWithoutALoan() {
        val list = listOf(person("zed"), person("Amy"), person("bob"))
        assertEquals(listOf("Amy", "bob", "zed"), visiblePeople(list, LoanFilter.All, "").map { it.name })
        assertEquals(listOf("amy", "Zed"), visiblePeople(listOf(person("Zed"), person("amy")), LoanFilter.All, "").map { it.name })
    }

    @Test
    fun theSearchAppearsOnlyWithEightOrMorePeopleInAll() {
        assertFalse(showSearch(List(7) { person("P$it") }))
        assertTrue(showSearch(List(8) { person("P$it") }))
    }

    @Test
    fun archivedPeopleCountTowardsTheEight() {
        assertTrue(showSearch(List(7) { person("P$it") } + person("Old", archived = true)))
    }

    @Test
    fun aSearchNarrowsByNameIgnoringCapitalLetters() {
        val many = List(8) { person("Person $it") } + person("Sam Rivera")
        assertEquals(listOf("Sam Rivera"), visiblePeople(many, LoanFilter.All, "sAm").map { it.name })
        assertEquals(listOf("Person 1"), visiblePeople(many, LoanFilter.All, "  person 1 ").map { it.name })
    }

    @Test
    fun aSearchIsIgnoredWhenTheSearchBoxIsNotOnScreen() {
        assertEquals(5, visiblePeople(all, LoanFilter.All, "zzz").size)
    }

    @Test
    fun theChipsAppearOnlyWhileSomeoneIsArchived() {
        assertTrue(showChips(all))
        assertFalse(showChips(listOf(sam, jo)))
        assertFalse(showChips(emptyList()))
    }

    @Test
    fun aPersonStandsInOneWord() {
        assertEquals(LoanStanding.OwesYou, standing(sam))
        assertEquals(LoanStanding.YouOwe, standing(jo))
        assertEquals(LoanStanding.Settled, standing(settled))
        assertEquals(LoanStanding.None, standing(casey))
        assertEquals(LoanStanding.Both, standing(person("Mixed", "USD" to 100L, "EUR" to -100L)))
    }

    @Test
    fun aSettledCurrencyDoesNotMakeAPersonOweOrBeOwed() {
        assertEquals(LoanStanding.OwesYou, standing(person("A", "USD" to 100L, "EUR" to 0L)))
    }

    @Test
    fun theCountsLeaveOutArchivedPeople() {
        assertEquals(1, owesYouCount(all))
        assertEquals(1, youOweCount(all))
        assertEquals(2, owesYouCount(listOf(sam, person("Other", "USD" to 5L), old)))
    }

    @Test
    fun aPersonWhoOwesInOneCurrencyAndIsOwedInAnotherCountsInBoth() {
        val mixed = person("Mixed", "USD" to 100L, "EUR" to -100L)
        assertEquals(1, owesYouCount(listOf(mixed)))
        assertEquals(1, youOweCount(listOf(mixed)))
    }

    @Test
    fun theLatestMovesAreNewestFirstByDateThenTimeThenId() {
        val lines = listOf(
            movement("a", "2026-10-01", 1),
            movement("c", "2026-10-03", 1, time = "09:00"),
            movement("b", "2026-10-03", 1, time = "17:00"),
            movement("d", "2026-10-03", 1, time = "17:00"),
        )
        // The later time comes first even though its id is lower; equal moments fall back to the id.
        assertEquals(listOf("d", "b", "c", "a"), latestMovements(lines).map { it.id })
    }

    @Test
    fun onlyTheLatestEightAreKept() {
        val lines = List(12) { movement("m$it", "2026-10-%02d".format(it + 1), 1) }
        assertEquals(MovementLimit, latestMovements(lines).size)
        assertEquals("m11", latestMovements(lines).first().id)
        assertEquals(3, latestMovements(lines, limit = 3).size)
    }

    @Test
    fun aMovePositiveWasSentAndNegativeReceived() {
        assertTrue(isSent(movement("a", "2026-10-01", 100)))
        assertFalse(isSent(movement("a", "2026-10-01", -100)))
    }

    @Test
    fun theSummarySitsSideBySideOnlyWhileThereIsRoom() {
        assertTrue(summaryInColumns(contentWidthDp = 326f, fontScale = 1f, longestAmount = 9))
        assertFalse(summaryInColumns(contentWidthDp = 256f, fontScale = 1f, longestAmount = 9))
        assertTrue(summaryInColumns(contentWidthDp = 280f, fontScale = 1f, longestAmount = 9))
    }

    @Test
    fun enlargedTextStacksTheSummary() {
        assertFalse(summaryInColumns(contentWidthDp = 326f, fontScale = 1.3f, longestAmount = 9))
        assertTrue(summaryInColumns(contentWidthDp = 326f, fontScale = 0.85f, longestAmount = 9))
        // Smaller text does not make room: the width still has to be 280 dp.
        assertFalse(summaryInColumns(contentWidthDp = 270f, fontScale = 0.85f, longestAmount = 9))
    }

    @Test
    fun aLongAmountStacksTheSummary() {
        assertTrue(summaryInColumns(contentWidthDp = 326f, fontScale = 1f, longestAmount = 11))
        assertFalse(summaryInColumns(contentWidthDp = 326f, fontScale = 1f, longestAmount = 12))
    }

    @Test
    fun onlyAPositiveBalanceIsOwedToYou() {
        assertTrue(isOwedToYou(app.ledgerline.android.ui.clients.loan("USD", 1)))
        assertFalse(isOwedToYou(app.ledgerline.android.ui.clients.loan("USD", 0)))
        assertFalse(isOwedToYou(app.ledgerline.android.ui.clients.loan("USD", -1)))
    }
}
