package app.ledgerline.android.ui.clients

import app.ledgerline.api.Contact
import app.ledgerline.api.HistoryEvent
import app.ledgerline.api.Money
import app.ledgerline.api.Service
import java.time.Instant
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/*
 * What the Clients screens decide, as plain functions of plain data (ADR 0046): which clients a chip shows, in what
 * order, the total they owe, how long ago the oldest unpaid service was, which services are unpaid, and how the
 * history's lines are batched. The screens only draw the answers.
 */

/** Open: clients who are not archived and owe something. Settled: clients who owe nothing. All: everyone. */
enum class ClientFilter { Open, Settled, All }

/** A client owes when something on their open balance is above zero. */
fun owes(client: Contact): Boolean = client.openBalance.amount > 0

fun matches(client: Contact, filter: ClientFilter): Boolean = when (filter) {
    ClientFilter.Open -> client.archivedAt == null && owes(client)
    ClientFilter.Settled -> !owes(client)
    ClientFilter.All -> true
}

/** The clients [filter] shows, those who owe the most first and then by name. */
fun visibleClients(clients: List<Contact>, filter: ClientFilter): List<Contact> =
    clients.filter { matches(it, filter) }.sortedWith(compareByDescending<Contact> { it.openBalance.amount }.thenBy { it.name.lowercase() })

/** What the open clients owe together, in the base currency, and from how many clients. */
data class ClientsTotal(val amount: Money, val clients: Int, val unconverted: List<String>)

/** Null when no client owes anything. */
fun clientsTotal(clients: List<Contact>): ClientsTotal? {
    val open = clients.filter { matches(it, ClientFilter.Open) }
    if (open.isEmpty()) return null
    return ClientsTotal(
        Money(open.sumOf { it.openBalance.amount }, open.first().openBalance.currency),
        open.size,
        open.flatMap { it.unconvertedCurrencies }.distinct().sorted(),
    )
}

/** How many whole days before [today] the date [date] (`YYYY-MM-DD`) was; null for a date in the future or one that is not a date. */
fun daysAgo(date: String, today: LocalDate): Long? {
    val then = runCatching { LocalDate.parse(date) }.getOrNull() ?: return null
    return ChronoUnit.DAYS.between(then, today).takeIf { it >= 0 }
}

/** A service that still has something left to pay (a written-off one has nothing left). */
fun isUnpaid(service: Service): Boolean = service.outstanding.amount > 0

/** The unpaid services, overdue ones first and then the oldest first; the paid ones, in the order they came. */
data class SplitServices(val unpaid: List<Service>, val paid: List<Service>)

fun splitServices(services: List<Service>, today: String): SplitServices {
    val unpaid = services.filter(::isUnpaid)
        .sortedWith(compareByDescending<Service> { isOverdue(it, today) }.thenBy { it.serviceDate }.thenBy { it.serviceTime.orEmpty() })
    return SplitServices(unpaid, services.filterNot(::isUnpaid))
}

/** How many services are overdue, and the earliest of their due dates; null when none is. */
fun overdueSummary(services: List<Service>, today: String): Pair<Int, String>? {
    val overdue = services.filter { isOverdue(it, today) }
    if (overdue.isEmpty()) return null
    return overdue.size to overdue.mapNotNull { it.dueDate }.min()
}

/** A segment's count: the number loaded, with a plus when more is still to load. */
fun countLabel(loaded: Int, hasMore: Boolean): String = if (hasMore) "$loaded+" else loaded.toString()

/** One line of a client's history: an event alone, or a few of the same kind written together. */
sealed interface HistoryLine {
    data class Single(val event: HistoryEvent) : HistoryLine

    /** [events] are in the order they were listed (newest first); there are two or more, all [action], all in [currency]. */
    data class Batch(val action: String, val events: List<HistoryEvent>, val currency: String) : HistoryLine {
        val total: Long get() = events.sumOf { amountOf(it) }
    }
}

/** What an event moved: a payment's amount, or the service's. */
fun amountOf(event: HistoryEvent): Long = event.after.payment?.amount?.amount ?: event.after.service.amount.amount

fun currencyOf(event: HistoryEvent): String = event.after.payment?.amount?.currency ?: event.after.service.amount.currency

/** Only a service being logged and a payment being received are batched; corrections, deletions and the rest stay one line each. */
private val Batchable = setOf("created", "paymentCreated")

/** The minute an event was written in, which is what makes events a batch ("2026-10-21T23:19"). */
private fun minuteOf(event: HistoryEvent): String? = runCatching { Instant.parse(event.createdAt).truncatedTo(ChronoUnit.MINUTES).toString() }.getOrNull()

/**
 * Consecutive events of the same batchable kind, written in the same minute and in the same currency, become one
 * [HistoryLine.Batch] (the owner receiving one payment across three services, or logging three services at once).
 * Everything else, and a lone event, stays [HistoryLine.Single]. The order is kept.
 */
fun batchHistory(events: List<HistoryEvent>): List<HistoryLine> {
    val lines = mutableListOf<HistoryLine>()
    var group = mutableListOf<HistoryEvent>()

    fun flush() {
        when {
            group.isEmpty() -> Unit
            group.size == 1 -> lines += HistoryLine.Single(group.single())
            else -> lines += HistoryLine.Batch(group.first().action, group.toList(), currencyOf(group.first()))
        }
        group = mutableListOf()
    }

    for (event in events) {
        val joins = group.isNotEmpty() && event.action in Batchable && event.action == group.first().action &&
            minuteOf(event) != null && minuteOf(event) == minuteOf(group.first()) && currencyOf(event) == currencyOf(group.first())
        if (!joins) flush()
        group += event
    }
    flush()
    return lines
}

/** The dates a batch of services covers: the earliest and the latest of their service dates (the same date once when it is one day). */
fun serviceDateRange(events: List<HistoryEvent>): Pair<String, String> {
    val dates = events.map { it.after.service.serviceDate }
    return dates.min() to dates.max()
}
