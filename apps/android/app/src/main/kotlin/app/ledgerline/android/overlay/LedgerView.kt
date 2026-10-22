package app.ledgerline.android.overlay

import app.ledgerline.android.mirror.AccountBalance
import app.ledgerline.android.mirror.EntryLine
import app.ledgerline.android.mirror.MirrorDao
import app.ledgerline.android.mirror.MirrorReads
import app.ledgerline.android.outbox.OutboxDao
import app.ledgerline.android.outbox.OutboxRow
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** A line of the entries list, and whether a change to it is still waiting to be sent. */
data class ShownLine(val line: EntryLine, val unsent: Boolean)

/**
 * What the screens show (ADR 0043, slice 4): the mirror, with the pending outbox changes laid over it by [Overlay].
 * The mirror's SQL does the bulk (balances, the list); only the entries a pending change touches are rebuilt here.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@Singleton
class LedgerView @Inject constructor(
    private val reads: MirrorReads,
    private val dao: MirrorDao,
    private val outbox: OutboxDao,
) {
    /** Balances including the cleared entries not yet sent. */
    fun accounts(ledgerId: String): Flow<List<AccountBalance>> =
        combine(reads.accountBalances(ledgerId, includeHidden = false), outbox.observePending(ledgerId)) { balances, changes ->
            if (changes.isEmpty()) return@combine balances
            val (mirror, shown) = overlay(ledgerId, changes)
            val change = balanceChanges(mirror, shown)
            balances.map { it.copy(balance = it.balance + (change[it.id] ?: 0)) }
        }

    /** The newest [limit] entries, with unsent ones marked. */
    fun entries(ledgerId: String, limit: Int): Flow<List<ShownLine>> =
        outbox.observePending(ledgerId).flatMapLatest { changes ->
            // Read a few more than shown: the ones a change touches are replaced by their rebuilt version.
            val touched = changes.size * 2
            reads.entryLines(ledgerId, limit + touched).map { lines ->
                if (changes.isEmpty()) return@map lines.take(limit).map { ShownLine(it, unsent = false) }
                val (_, shown) = overlay(ledgerId, changes)
                val rebuilt = lines(ledgerId, shown.values.filterNotNull())
                (lines.filter { it.id !in shown.keys }.map { ShownLine(it, unsent = false) } + rebuilt)
                    .sortedWith(compareBy(NewestFirst) { it.asShown() })
                    .take(limit)
            }
        }

    /** One entry as it will be once sent, for the edit form; null when it is gone or being deleted. */
    suspend fun entry(ledgerId: String, id: String, changes: List<OutboxRow>): ShownEntry? {
        val row = reads.liveByIds(ledgerId, listOf(id)).firstOrNull()
        val mirror = listOfNotNull(row?.shown(reads.liveTagLinks(ledgerId, listOf(id)).map { it.tagId }))
        return Overlay.apply(mirror, changes)[id]
    }

    private suspend fun overlay(ledgerId: String, changes: List<OutboxRow>): Pair<List<ShownEntry>, Map<String, ShownEntry?>> {
        val entryIds = changes.filter { it.kind == "transaction" }.map { it.entityId }.distinct()
        val transferIds = changes.filter { it.kind == "transfer" }.map { it.entityId }.distinct()
        val rows = (
            entryIds.chunked(Chunk).flatMap { reads.liveByIds(ledgerId, it) } +
                transferIds.chunked(Chunk).flatMap { reads.liveByTransfer(ledgerId, it) }
            ).distinctBy { it.id }
        val tags = rows.map { it.id }.chunked(Chunk).flatMap { reads.liveTagLinks(ledgerId, it) }
            .groupBy({ it.transactionId }, { it.tagId })
        val mirror = rows.map { it.shown(tags[it.id].orEmpty()) }
        return mirror to Overlay.apply(mirror, changes)
    }

    /** Rebuilt entries as list lines, with the names joined the way the SQL list joins them. */
    private suspend fun lines(ledgerId: String, entries: List<ShownEntry>): List<ShownLine> {
        if (entries.isEmpty()) return emptyList()
        val accounts = dao.allAccounts(ledgerId).associate { it.id to it.name }
        val categories = dao.allCategories(ledgerId).associate { it.id to it.name }
        val tags = dao.allTags(ledgerId).filter { it.deletedAt == null }.associate { it.id to it.name }
        return entries.map { entry ->
            val tagNames = entry.tagIds.mapNotNull { tags[it] }.sortedBy { it.lowercase() }.joinToString(", ").ifEmpty { null }
            ShownLine(
                EntryLine(
                    id = entry.id,
                    date = entry.date,
                    time = entry.time,
                    kind = entry.kind,
                    isSplit = entry.isSplit,
                    status = entry.status,
                    amount = entry.amount,
                    currency = entry.currency,
                    payee = entry.payee,
                    accountName = accounts[entry.accountId],
                    categoryName = entry.categoryId?.let { categories[it] },
                    tagNames = tagNames,
                    transferId = entry.transferId,
                    createdAt = entry.createdAt,
                ),
                unsent = entry.unsent,
            )
        }
    }

    private fun ShownLine.asShown() = ShownEntry(
        id = line.id, accountId = "", categoryId = null, kind = line.kind, isSplit = line.isSplit, date = line.date,
        time = line.time, amount = line.amount, currency = line.currency, payee = line.payee, note = null,
        status = line.status, tagIds = emptyList(), createdAt = line.createdAt, transferId = line.transferId, unsent = unsent,
    )

    private companion object {
        const val Chunk = 400
    }
}
