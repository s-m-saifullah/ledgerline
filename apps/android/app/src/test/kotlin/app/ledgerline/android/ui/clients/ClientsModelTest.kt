package app.ledgerline.android.ui.clients

import app.ledgerline.api.Money
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class ClientsModelTest {
    private val ada = contact("Ada", owed = 5000, oldest = "2026-10-01")
    private val bo = contact("Bo", owed = 25000, oldest = "2026-10-05")
    private val cy = contact("Cy", owed = 5000, oldest = "2026-10-09")
    private val settled = contact("Dee")
    private val gone = contact("Eve", owed = 700, archived = true)
    private val all = listOf(ada, bo, cy, settled, gone)

    @Test
    fun openShowsClientsWhoOweAndAreNotArchived() {
        assertEquals(listOf("Bo", "Ada", "Cy"), visibleClients(all, ClientFilter.Open).map { it.name })
    }

    @Test
    fun settledShowsClientsWhoOweNothing() {
        assertEquals(listOf("Dee"), visibleClients(all, ClientFilter.Settled).map { it.name })
    }

    @Test
    fun allShowsEveryoneWithTheBiggestDebtFirstThenByName() {
        assertEquals(listOf("Bo", "Ada", "Cy", "Eve", "Dee"), visibleClients(all, ClientFilter.All).map { it.name })
    }

    @Test
    fun theOrderIgnoresCapitalLettersForEqualDebts() {
        val list = listOf(contact("Zed", owed = 100), contact("amy", owed = 100))
        assertEquals(listOf("amy", "Zed"), visibleClients(list, ClientFilter.Open).map { it.name })
    }

    @Test
    fun theTotalAddsOnlyTheOpenClients() {
        val total = clientsTotal(all)!!
        assertEquals(Money(35000, "USD"), total.amount)
        assertEquals(3, total.clients)
    }

    @Test
    fun theTotalNamesCurrenciesWithoutARateOnce() {
        val list = listOf(contact("A", owed = 100, unconverted = listOf("EUR")), contact("B", owed = 100, unconverted = listOf("EUR", "BDT")))
        assertEquals(listOf("BDT", "EUR"), clientsTotal(list)!!.unconverted)
    }

    @Test
    fun noTotalWhenNobodyOwes() {
        assertNull(clientsTotal(listOf(settled, gone)))
        assertNull(clientsTotal(emptyList()))
    }

    @Test
    fun daysAgoCountsWholeDays() {
        val today = LocalDate.of(2026, 10, 23)
        assertEquals(12L, daysAgo("2026-10-11", today))
        assertEquals(0L, daysAgo("2026-10-23", today))
        assertNull(daysAgo("2026-10-24", today))
        assertNull(daysAgo("not a date", today))
    }

    @Test
    fun anUnpaidServiceHasSomethingLeft() {
        assertTrue(isUnpaid(service("A", 1000)))
        assertTrue(isUnpaid(service("B", 1000, received = 400)))
        assertFalse(isUnpaid(service("C", 1000, received = 1000)))
        assertFalse(isUnpaid(service("D", 1000, writtenOff = 1000)))
    }

    @Test
    fun unpaidServicesPutTheOverdueFirstThenTheOldest() {
        val today = "2026-10-23"
        val late = service("Late", 100, date = "2026-10-20", due = "2026-10-22")
        val old = service("Old", 100, date = "2026-09-01")
        val newer = service("Newer", 100, date = "2026-10-10")
        val paid = service("Paid", 100, received = 100)
        val split = splitServices(listOf(newer, paid, late, old), today)
        assertEquals(listOf("Late", "Old", "Newer"), split.unpaid.map { it.description })
        assertEquals(listOf("Paid"), split.paid.map { it.description })
    }

    @Test
    fun aServiceIsOverdueOnlyAfterItsDueDateAndWhileSomethingIsLeft() {
        assertTrue(isOverdue(service("A", 100, due = "2026-10-22"), "2026-10-23"))
        assertFalse(isOverdue(service("A", 100, due = "2026-10-23"), "2026-10-23"))
        assertFalse(isOverdue(service("A", 100), "2026-10-23"))
        assertFalse(isOverdue(service("A", 100, received = 100, due = "2026-10-01"), "2026-10-23"))
    }

    @Test
    fun theOverdueSummaryCountsThemAndGivesTheEarliestDueDate() {
        val services = listOf(service("A", 100, due = "2026-10-20"), service("B", 100, due = "2026-10-05"), service("C", 100, due = "2026-12-01"))
        assertEquals(2 to "2026-10-05", overdueSummary(services, "2026-10-23"))
        assertNull(overdueSummary(listOf(service("C", 100, due = "2026-12-01")), "2026-10-23"))
    }

    @Test
    fun aCountHasAPlusWhileMoreIsToLoad() {
        assertEquals("4", countLabel(4, hasMore = false))
        assertEquals("50+", countLabel(50, hasMore = true))
    }

    private val sale = service("Sales", 7200, id = "s1")
    private val other = service("Logo", 14400, id = "s2")
    private fun at(minute: String) = "2026-10-21T23:$minute:00.000Z"

    @Test
    fun consecutivePaymentsWrittenInTheSameMinuteBecomeOneLine() {
        val events = listOf(
            event("paymentCreated", sale, payment(sale, 14400), createdAt = at("19").replace(":00.000", ":50.000")),
            event("paymentCreated", other, payment(other, 7200), createdAt = at("19")),
            event("paymentCreated", sale, payment(sale, 7200, date = "2026-10-06"), createdAt = at("19"), id = "third"),
        )
        val lines = batchHistory(events)
        assertEquals(1, lines.size)
        val batch = lines.single() as HistoryLine.Batch
        assertEquals("paymentCreated", batch.action)
        assertEquals(3, batch.events.size)
        assertEquals(28800L, batch.total)
        assertEquals("USD", batch.currency)
    }

    @Test
    fun paymentsInDifferentMinutesStaySeparate() {
        val events = listOf(
            event("paymentCreated", sale, payment(sale, 100), createdAt = at("19")),
            event("paymentCreated", other, payment(other, 200), createdAt = at("20")),
        )
        assertTrue(batchHistory(events).all { it is HistoryLine.Single })
    }

    @Test
    fun aLineOfAnotherKindBetweenTwoBreaksTheBatch() {
        val events = listOf(
            event("created", sale, createdAt = at("19")),
            event("paymentCreated", sale, payment(sale, 100), createdAt = at("19")),
            event("created", other, createdAt = at("19")),
        )
        assertEquals(3, batchHistory(events).size)
        assertTrue(batchHistory(events).all { it is HistoryLine.Single })
    }

    @Test
    fun servicesLoggedTogetherBecomeOneLine() {
        val events = listOf(event("created", sale, createdAt = at("19")), event("created", other, createdAt = at("19")))
        val batch = batchHistory(events).single() as HistoryLine.Batch
        assertEquals("created", batch.action)
        assertEquals(7200L + 14400L, batch.total)
    }

    @Test
    fun eventsInDifferentCurrenciesAreNeverBatchedTogether() {
        val euros = other.copy(amount = Money(7200, "EUR"))
        val events = listOf(event("created", sale, createdAt = at("19")), event("created", euros, createdAt = at("19"), id = "eur"))
        assertEquals(2, batchHistory(events).size)
        assertTrue(batchHistory(events).all { it is HistoryLine.Single })
    }

    @Test
    fun correctionsAndDeletionsAreNeverBatched() {
        val events = listOf(
            event("edited", sale, createdAt = at("19")),
            event("edited", other, createdAt = at("19")),
            event("deleted", sale, createdAt = at("19")),
            event("deleted", other, createdAt = at("19")),
        )
        assertEquals(4, batchHistory(events).size)
    }

    @Test
    fun separateBatchesKeepTheirOrderAndALoneEventStaysSingle() {
        val events = listOf(
            event("paymentCreated", sale, payment(sale, 100), createdAt = at("21")),
            event("paymentCreated", other, payment(other, 200), createdAt = at("21")),
            event("created", sale, createdAt = at("20")),
            event("created", other, createdAt = at("19"), id = "b1"),
            event("created", sale, createdAt = at("19"), id = "b2"),
        )
        val lines = batchHistory(events)
        assertEquals(3, lines.size)
        assertEquals("paymentCreated", (lines[0] as HistoryLine.Batch).action)
        assertTrue(lines[1] is HistoryLine.Single)
        assertEquals(2, (lines[2] as HistoryLine.Batch).events.size)
    }

    @Test
    fun nothingGivesNoLines() {
        assertEquals(emptyList<HistoryLine>(), batchHistory(emptyList()))
    }

    @Test
    fun theDatesABatchOfServicesCoversRunFromTheEarliestToTheLatest() {
        val a = service("A", 100, date = "2026-10-18", id = "a")
        val b = service("B", 100, date = "2026-10-14", id = "b")
        val c = service("C", 100, date = "2026-10-16", id = "c")
        assertEquals("2026-10-14" to "2026-10-18", serviceDateRange(listOf(event("created", a), event("created", b), event("created", c))))
    }

    @Test
    fun anEventMovesWhatIsOwedTheWayItsKindSays() {
        assertEquals(1, historySign("created"))
        assertEquals(1, historySign("restored"))
        assertEquals(1, historySign("paymentDeleted"))
        assertEquals(-1, historySign("paymentCreated"))
        assertEquals(-1, historySign("paymentRestored"))
        assertEquals(-1, historySign("deleted"))
        assertEquals(0, historySign("edited"))
        assertEquals(0, historySign("writtenOff"))
        assertEquals(0, historySign("reopened"))
        assertEquals(0, historySign("paymentEdited"))
    }
}
