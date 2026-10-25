package app.ledgerline.android.ui.home

import app.ledgerline.android.mirror.EntryLine
import app.ledgerline.android.overlay.ShownLine
import app.ledgerline.api.Money
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Merging a transfer's legs and a day's net (ADR 0046), as plain data. */
class TransactionsModelTest {
    private fun line(
        id: String,
        amount: Long,
        kind: String = "expense",
        date: String = "2026-10-22",
        currency: String = "USD",
        status: String = "cleared",
        transferId: String? = null,
        account: String = "Checking",
        unsent: Boolean = false,
    ) = ShownLine(EntryLine(id, date, null, kind, false, status, amount, currency, "payee $id", account, "Food", null, transferId, "${date}T10:00:00Z"), unsent)

    private fun leg(id: String, amount: Long, transfer: String = "t1", account: String = "Checking", currency: String = "USD", date: String = "2026-10-22", status: String = "cleared") =
        line(id, amount, "transfer", date, currency, status, transfer, account)

    @Test
    fun theTwoLegsOfAPlainTransferBecomeOneRowAtTheFirstLegsPlace() {
        val rows = mergeTransfers(listOf(line("a", -100), leg("out", -4800), line("b", -200), leg("in", 4800, account = "Cash")))
        assertEquals(3, rows.size)
        assertTrue(rows[0] is EntryRowModel.Single)
        val transfer = rows[1] as EntryRowModel.Transfer
        assertEquals("out", transfer.out.line.id)
        assertEquals("in", transfer.into.line.id)
        assertTrue(rows[2] is EntryRowModel.Single)
    }

    @Test
    fun theLegsMergeWhicheverComesFirst() {
        val transfer = mergeTransfers(listOf(leg("in", 4800, account = "Cash"), leg("out", -4800))).single() as EntryRowModel.Transfer
        assertEquals("out", transfer.out.line.id)
        assertEquals("in", transfer.into.line.id)
    }

    @Test
    fun aTransferWithOneLegShownStaysAsItIs() {
        val rows = mergeTransfers(listOf(leg("out", -4800)))
        assertTrue(rows.single() is EntryRowModel.Single)
    }

    @Test
    fun aTransferThatIsNotPlainKeepsItsLegs() {
        // A fee, a bonus or another currency means the amounts differ: each leg's own amount is the truth.
        assertEquals(2, mergeTransfers(listOf(leg("out", -4800), leg("in", 4700))).count { it is EntryRowModel.Single })
        assertEquals(2, mergeTransfers(listOf(leg("out", -4800), leg("in", 4800, currency = "EUR"))).count { it is EntryRowModel.Single })
        assertEquals(2, mergeTransfers(listOf(leg("a", 0), leg("b", 0))).count { it is EntryRowModel.Single })
    }

    @Test
    fun twoTransfersAreTwoRowsAndThreeLegsAreNotMerged() {
        val two = mergeTransfers(listOf(leg("o1", -1, "t1"), leg("o2", -2, "t2"), leg("i1", 1, "t1"), leg("i2", 2, "t2")))
        assertEquals(2, two.count { it is EntryRowModel.Transfer })
        val three = mergeTransfers(listOf(leg("a", -1), leg("b", 1), leg("c", 1)))
        assertEquals(3, three.count { it is EntryRowModel.Single })
    }

    @Test
    fun aDaysNetCountsClearedEntriesOnlyAndLeavesTransfersOut() {
        val day = groupDays(
            listOf(
                line("a", -1771), line("b", -2500), line("c", 5000, "income"),
                line("pending", -9999, status = "pending"),
                leg("out", -4800), leg("in", 4800, account = "Cash"),
            ),
        ).single()
        assertEquals(listOf(Money(729, "USD")), day.nets)
    }

    @Test
    fun aDayHasOneNetPerCurrencyInOrder() {
        val day = groupDays(listOf(line("a", -1000), line("b", -71338, currency = "BDT"), line("c", 500, currency = "BDT"))).single()
        assertEquals(listOf(Money(-70838, "BDT"), Money(-1000, "USD")), day.nets)
    }

    @Test
    fun aDayWithNothingClearedHasNoNet() {
        assertEquals(emptyList<Money>(), groupDays(listOf(line("a", -1, status = "pending"), leg("o", -5), leg("i", 5))).single().nets)
    }

    @Test
    fun daysKeepTheListsOrder() {
        val days = groupDays(listOf(line("a", -1, date = "2026-10-22"), line("b", -1, date = "2026-10-21"), line("c", -1, date = "2026-10-22")))
        assertEquals(listOf("2026-10-22", "2026-10-21"), days.map { it.date })
        assertEquals(2, days[0].rows.size)
    }
}
