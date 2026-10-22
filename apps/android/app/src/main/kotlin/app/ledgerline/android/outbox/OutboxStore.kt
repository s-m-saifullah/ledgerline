package app.ledgerline.android.outbox

import androidx.room.withTransaction
import app.ledgerline.android.mirror.MirrorDatabase
import app.ledgerline.android.mirror.MirrorStore
import app.ledgerline.android.mirror.toRow
import app.ledgerline.api.ApiJson
import app.ledgerline.api.SyncMutation
import app.ledgerline.api.SyncPushResult
import app.ledgerline.api.SyncTransaction
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import java.time.Instant
import java.time.temporal.ChronoUnit
import javax.inject.Inject
import javax.inject.Singleton

/** The phone's wall clock, for `editedAt` and new ids (the lock uses a monotonic clock instead). */
fun interface WallClock {
    fun now(): Instant
}

@Module
@InstallIn(SingletonComponent::class)
object WallClockModule {
    @Provides
    fun wallClock(): WallClock = WallClock { Instant.now() }
}

/**
 * The outbox (ADR 0043, slice 4): every change made on the phone, kept until the server has settled it. Rules:
 *
 * - A change not yet sent is folded: an edit changes it, a delete of an unsent create removes it, so the server never
 *   sees half a story. A change that has been sent once is never altered (the server may already have it); a later
 *   edit becomes its own change.
 * - `baseVersion` is the version the phone expects the row to have when the change arrives: the mirror's, plus one
 *   for each earlier change of the same row that was sent without a known result.
 * - The server's answer to a batch is applied in one transaction: applied and replayed changes leave, superseded and
 *   rejected ones stay for the owner to decide (never dropped), and the rows the server returned update the mirror.
 */
@Singleton
class OutboxStore @Inject constructor(
    private val database: MirrorDatabase,
    private val mirrorStore: MirrorStore,
    private val clock: WallClock,
) {
    private val outbox = database.outbox()
    private val mirror = database.dao()

    /** Test hook: runs inside the results transaction after every change is applied and before it commits. */
    @Volatile
    internal var beforeResultsCommit: (() -> Unit)? = null

    /** Records a new entry; returns its id (also the mutation id). [body] is the body of `POST /transactions`. */
    suspend fun createEntry(ledgerId: String, body: JsonObject): String = create(ledgerId, Entry, body)

    /** [changes] holds only the changed fields of `PATCH /transactions/{id}`, without `expectedVersion`. */
    suspend fun updateEntry(ledgerId: String, entryId: String, changes: JsonObject) =
        update(ledgerId, Entry, entryId, changes, merge = true)

    suspend fun deleteEntry(ledgerId: String, entryId: String) = delete(ledgerId, Entry, entryId, JsonObject(emptyMap()))

    /** Records a new transfer; returns its `transferId`. [body] is the body of `POST /transfers`. */
    suspend fun createTransfer(ledgerId: String, body: JsonObject): String = create(ledgerId, Transfer, body)

    /** [body] holds every field of `PATCH /transfers/{id}` (the transfer is replaced), without `expectedVersion`. */
    suspend fun updateTransfer(ledgerId: String, transferId: String, body: JsonObject) =
        update(ledgerId, Transfer, transferId, body, merge = false)

    suspend fun deleteTransfer(ledgerId: String, transferId: String, body: JsonObject = JsonObject(emptyMap())) =
        delete(ledgerId, Transfer, transferId, body)

    /** The oldest changes still to send for [ledgerId], marked as sent once in the same transaction. */
    suspend fun takeBatch(ledgerId: String, limit: Int = BatchSize): List<OutboxRow> = database.withTransaction {
        val batch = outbox.pending(ledgerId, limit)
        if (batch.isNotEmpty()) outbox.markAttempted(batch.map { it.id })
        batch.map { it.copy(attempted = true) }
    }

    /** Applies the server's results for [batch]; changes nothing if they do not answer it exactly, in order. */
    suspend fun settle(ledgerId: String, batch: List<OutboxRow>, results: List<SyncPushResult>) {
        check(results.map { it.id.lowercase() } == batch.map { it.id.lowercase() }) { "The results do not answer the batch." }
        database.withTransaction {
            for ((row, result) in batch.zip(results)) {
                mirrorStore.applyTransactionRows(ledgerId, result.rows.map { it.toRow(ledgerId) })
                when (result.status) {
                    "applied", "replayed" -> outbox.delete(row.id)
                    "superseded" -> outbox.update(
                        row.copy(
                            state = OutboxRow.Superseded,
                            serverRows = ApiJson.encodeToString(ListSerializer(SyncTransaction.serializer()), result.rows),
                        ),
                    )
                    // Rejected, or a result this version of the app does not know: keep it for the owner.
                    else -> outbox.update(
                        row.copy(
                            state = OutboxRow.Rejected,
                            problemTitle = result.problem?.title ?: result.status,
                            problemDetail = result.problem?.detail,
                        ),
                    )
                }
            }
            beforeResultsCommit?.invoke()
        }
    }

    suspend fun needingAttention(): List<OutboxRow> = outbox.needingAttention()

    /** Superseded and rejected changes, for the Needs your attention list. */
    val attention: Flow<List<OutboxRow>> = outbox.observeNeedingAttention()

    /** Changes not sent yet (or sent without a known result). */
    val unsent: Flow<Int> = outbox.observeUnsentCount()

    /** Every change the server does not have: unsent, superseded or rejected (what a sign-out would delete). */
    suspend fun notOnServerCount(): Int = outbox.notOnServerCount()

    suspend fun unsentCount(): Int = outbox.unsentCount()

    /**
     * Sends the owner's version of a superseded change again, against the version the server now has. False when
     * there is nothing to apply it to (the row was deleted on the other device), so only Keep the other remains.
     */
    suspend fun keepMine(id: String): Boolean = database.withTransaction {
        val row = outbox.find(id)?.takeIf { it.state == OutboxRow.Superseded && it.action != "create" }
            ?: return@withTransaction false
        val serverRows = row.serverRows?.let { ApiJson.decodeFromString(ListSerializer(SyncTransaction.serializer()), it) }.orEmpty()
        val current = if (row.kind == Entry) {
            serverRows.find { it.id == row.entityId }
        } else {
            serverRows.find { it.transferId == row.entityId && it.kind == "transfer" && it.amount.amount < 0 }
        }
        if (current == null || current.deletedAt != null) return@withTransaction false
        outbox.delete(row.id)
        insert(row.ledgerId, row.kind, row.action, row.entityId, current.version, row.body)
        true
    }

    /** Drops a superseded change: the other device's version stays. */
    suspend fun keepTheirs(id: String) = dropSettled(id)

    /** Drops a rejected change. */
    suspend fun discard(id: String) = dropSettled(id)

    /** Deletes every change not yet settled. Only after the owner confirms it (signing out with unsent changes). */
    suspend fun clearAll() = outbox.clear()

    private suspend fun dropSettled(id: String) = database.withTransaction {
        outbox.find(id)?.takeIf { it.state != OutboxRow.Pending }?.let { outbox.delete(it.id) }
    }

    private suspend fun create(ledgerId: String, kind: String, body: JsonObject): String = database.withTransaction {
        insert(ledgerId, kind, "create", entityId = null, baseVersion = null, body = body.toString())
    }

    private suspend fun update(ledgerId: String, kind: String, entityId: String, changes: JsonObject, merge: Boolean) {
        database.withTransaction {
            val latest = outbox.latestPending(ledgerId, entityId)
            if (latest != null && !latest.attempted) {
                check(latest.action != "delete") { "This entry is being deleted." }
                val body = if (merge) JsonObject(parse(latest.body) + changes) else changes
                outbox.update(latest.copy(body = body.toString(), editedAt = now()))
            } else {
                insert(ledgerId, kind, "update", entityId, expectedVersion(ledgerId, kind, entityId), changes.toString())
            }
        }
    }

    private suspend fun delete(ledgerId: String, kind: String, entityId: String, body: JsonObject) {
        database.withTransaction {
            val latest = outbox.latestPending(ledgerId, entityId)
            if (latest != null && !latest.attempted) {
                when (latest.action) {
                    // Never sent: the server never needs to hear of it.
                    "create" -> {
                        outbox.delete(latest.id)
                        return@withTransaction
                    }
                    "delete" -> return@withTransaction
                    else -> outbox.delete(latest.id)
                }
            }
            insert(ledgerId, kind, "delete", entityId, expectedVersion(ledgerId, kind, entityId), body.toString())
        }
    }

    private suspend fun expectedVersion(ledgerId: String, kind: String, entityId: String): Int {
        val held = if (kind == Entry) mirror.transactionVersion(ledgerId, entityId) else mirror.transferVersion(ledgerId, entityId)
        val version = (held ?: 0) + outbox.inFlight(ledgerId, entityId)
        check(version >= 1) { "The phone does not know this ${if (kind == Entry) "entry" else "transfer"}." }
        return version
    }

    /** Adds a change at the end of the queue; a create's id is its entity's id. */
    private suspend fun insert(
        ledgerId: String,
        kind: String,
        action: String,
        entityId: String?,
        baseVersion: Int?,
        body: String,
    ): String {
        val id = Uuid7.next(clock.now().toEpochMilli())
        outbox.insert(
            OutboxRow(
                id = id,
                ledgerId = ledgerId,
                seq = outbox.maxSeq() + 1,
                kind = kind,
                action = action,
                entityId = entityId ?: id,
                baseVersion = baseVersion,
                editedAt = now(),
                body = body,
                attempted = false,
                state = OutboxRow.Pending,
                problemTitle = null,
                problemDetail = null,
                serverRows = null,
            ),
        )
        return id
    }

    private fun now() = clock.now().truncatedTo(ChronoUnit.MILLIS).toString()

    private fun parse(body: String): JsonObject = ApiJson.parseToJsonElement(body).jsonObject

    companion object {
        const val Entry = "transaction"
        const val Transfer = "transfer"
        const val BatchSize = 50
    }
}

/** The change as the push sends it. */
fun OutboxRow.toMutation() = SyncMutation(
    id = id,
    type = type,
    editedAt = editedAt,
    targetId = entityId.takeIf { action != "create" },
    baseVersion = baseVersion,
    body = ApiJson.parseToJsonElement(body).jsonObject,
)
