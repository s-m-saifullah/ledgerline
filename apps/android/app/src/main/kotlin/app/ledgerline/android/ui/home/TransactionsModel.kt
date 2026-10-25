package app.ledgerline.android.ui.home

import app.ledgerline.android.overlay.ShownLine
import app.ledgerline.api.Money

/** One row of a day: an entry, or the two legs of a plain transfer shown as one (ADR 0046). */
sealed interface EntryRowModel {
    val key: String

    data class Single(val shown: ShownLine) : EntryRowModel {
        override val key get() = shown.line.id
    }

    /** Money moved from [out]'s account to [into]'s; the legs have the same currency and opposite amounts. */
    data class Transfer(val out: ShownLine, val into: ShownLine) : EntryRowModel {
        override val key get() = "transfer-${out.line.transferId}"
    }
}

/** A day's rows in the list's order, and what the day came to in each currency (cleared entries, transfers left out). */
data class DayGroup(val date: String, val rows: List<EntryRowModel>, val nets: List<Money>)

/**
 * The two legs of a transfer become one row only when both are in the list and the transfer is plain: the same
 * currency and amounts that cancel out. A transfer with a fee, a bonus or two currencies (made on the web) keeps
 * its legs apart, as each leg's own amount is the truth; so does a transfer whose other leg a filter hides.
 */
fun mergeTransfers(lines: List<ShownLine>): List<EntryRowModel> {
    val legs = lines.filter { it.line.kind == "transfer" && it.line.transferId != null }.groupBy { it.line.transferId }
    val merged = legs.mapNotNull { (_, pair) ->
        if (pair.size != 2) return@mapNotNull null
        val (a, b) = pair
        if (a.line.currency != b.line.currency || a.line.amount + b.line.amount != 0L || a.line.amount == 0L) return@mapNotNull null
        val (out, into) = if (a.line.amount < 0) a to b else b to a
        out.line.transferId to EntryRowModel.Transfer(out, into)
    }.toMap()
    val placed = mutableSetOf<String?>()
    return lines.mapNotNull { shown ->
        val merge = merged[shown.line.transferId].takeIf { shown.line.kind == "transfer" }
        when {
            merge == null -> EntryRowModel.Single(shown)
            placed.add(shown.line.transferId) -> merge
            else -> null
        }
    }
}

/** The list, newest first, as days with their merged rows and nets. */
fun groupDays(items: List<ShownLine>): List<DayGroup> =
    items.groupBy { it.line.date }.map { (date, lines) ->
        val counted = lines.filter { it.line.kind != "transfer" && it.line.status == "cleared" }
        val nets = counted.groupBy { it.line.currency }.toSortedMap().map { (currency, group) -> Money(group.sumOf { it.line.amount }, currency) }
        DayGroup(date, mergeTransfers(lines), nets)
    }
