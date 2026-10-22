package app.ledgerline.android.outbox

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.ledgerline.android.mirror.MirrorDatabase
import app.ledgerline.android.mirror.MirrorStore
import app.ledgerline.api.SyncPush
import app.ledgerline.api.SyncPushProblem
import app.ledgerline.api.SyncPushResponse
import app.ledgerline.api.SyncPushResult
import app.ledgerline.api.SyncTransaction
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant

class FakeWallClock(var now: Instant = Instant.parse("2026-10-22T10:00:00Z")) : WallClock {
    override fun now() = now
}

fun memoryDatabase(): MirrorDatabase =
    Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), MirrorDatabase::class.java)
        .allowMainThreadQueries()
        .build()

fun outboxFor(database: MirrorDatabase, clock: WallClock = FakeWallClock()) = OutboxStore(database, MirrorStore(database), clock)

fun json(vararg pairs: Pair<String, Any?>) = JsonObject(
    pairs.associate { (key, value) ->
        key to when (value) {
            null -> kotlinx.serialization.json.JsonNull
            is Number -> JsonPrimitive(value)
            is Boolean -> JsonPrimitive(value)
            else -> JsonPrimitive(value.toString())
        }
    },
)

/**
 * A stand-in for the server's push: it remembers every mutation id it has applied, so a change sent again is
 * `replayed` and never applied twice. [answer] can turn a mutation into another result; [loseReply] makes the next
 * request apply everything and then fail as if the connection dropped.
 */
class FakeServer : PushSource {
    val applied = mutableListOf<String>()
    val requests = mutableListOf<SyncPush>()
    var answer: (String) -> SyncPushResult? = { null }
    var loseReply = false
    var fail: Throwable? = null

    override suspend fun push(ledgerId: String, body: SyncPush): SyncPushResponse {
        fail?.let { throw it }
        requests += body
        val results = body.mutations.map { mutation ->
            answer(mutation.id) ?: if (mutation.id in applied) {
                SyncPushResult(mutation.id, "replayed", emptyList())
            } else {
                applied += mutation.id
                SyncPushResult(mutation.id, "applied", emptyList())
            }
        }
        if (loseReply) {
            loseReply = false
            throw java.io.IOException("the reply was lost")
        }
        return SyncPushResponse(results)
    }
}

fun superseded(id: String, rows: List<SyncTransaction>) = SyncPushResult(id, "superseded", rows)

fun rejected(id: String) = SyncPushResult(id, "rejected", emptyList(), SyncPushProblem(422, "Invalid request", "The account is archived."))
