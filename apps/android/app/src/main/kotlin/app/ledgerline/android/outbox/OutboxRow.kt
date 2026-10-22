package app.ledgerline.android.outbox

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

/**
 * One change made on the phone and not yet settled with the server (ADR 0043, slice 4). [id] is the mutation id (a
 * UUIDv7, also the idempotency key; for a create also the new entry's or transfer's id). Rows are sent in [seq] order.
 * Once [attempted] is true the row may have reached the server, so its contents never change again.
 */
@Entity(tableName = "outbox", indices = [Index("ledgerId", "seq"), Index("ledgerId", "entityId")])
data class OutboxRow(
    @PrimaryKey val id: String,
    val ledgerId: String,
    val seq: Long,
    /** "transaction" or "transfer". */
    val kind: String,
    /** "create", "update" or "delete". */
    val action: String,
    /** The entry id or the transfer id the change is about. */
    val entityId: String,
    val baseVersion: Int?,
    val editedAt: String,
    /** The request body as JSON text. */
    val body: String,
    val attempted: Boolean,
    val state: String,
    val problemTitle: String?,
    val problemDetail: String?,
    /** For a superseded change: the server's rows (JSON array of pulled transactions) that won. */
    val serverRows: String?,
) {
    val type get() = "$kind.$action"

    companion object {
        const val Pending = "pending"
        const val Superseded = "superseded"
        const val Rejected = "rejected"
    }
}

@Dao
interface OutboxDao {
    @Insert
    suspend fun insert(row: OutboxRow)

    @Update
    suspend fun update(row: OutboxRow)

    @Query("DELETE FROM outbox WHERE id = :id")
    suspend fun delete(id: String)

    @Query("SELECT * FROM outbox WHERE id = :id")
    suspend fun find(id: String): OutboxRow?

    @Query("SELECT COALESCE(MAX(seq), 0) FROM outbox")
    suspend fun maxSeq(): Long

    /** The next changes to send for a ledger, oldest first. */
    @Query("SELECT * FROM outbox WHERE ledgerId = :ledgerId AND state = 'pending' ORDER BY seq LIMIT :limit")
    suspend fun pending(ledgerId: String, limit: Int): List<OutboxRow>

    /** The newest change still to be sent for one entry or transfer. */
    @Query("SELECT * FROM outbox WHERE ledgerId = :ledgerId AND entityId = :entityId AND state = 'pending' ORDER BY seq DESC LIMIT 1")
    suspend fun latestPending(ledgerId: String, entityId: String): OutboxRow?

    /** Sent at least once, result not known yet: each may already have raised the row's version by one. */
    @Query("SELECT COUNT(*) FROM outbox WHERE ledgerId = :ledgerId AND entityId = :entityId AND state = 'pending' AND attempted = 1")
    suspend fun inFlight(ledgerId: String, entityId: String): Int

    @Query("UPDATE outbox SET attempted = 1 WHERE id IN (:ids)")
    suspend fun markAttempted(ids: List<String>)

    @Query("SELECT * FROM outbox WHERE state != 'pending' ORDER BY seq")
    suspend fun needingAttention(): List<OutboxRow>

    @Query("SELECT * FROM outbox WHERE state != 'pending' ORDER BY seq")
    fun observeNeedingAttention(): Flow<List<OutboxRow>>

    @Query("SELECT COUNT(*) FROM outbox WHERE state = 'pending'")
    fun observeUnsentCount(): Flow<Int>

    @Query("SELECT * FROM outbox ORDER BY seq")
    suspend fun all(): List<OutboxRow>

    @Query("SELECT COUNT(*) FROM outbox WHERE state = 'pending'")
    suspend fun unsentCount(): Int

    @Query("DELETE FROM outbox")
    suspend fun clear()
}
