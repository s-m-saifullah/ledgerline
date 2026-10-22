package app.ledgerline.android.outbox

import app.ledgerline.android.mirror.Attempt
import app.ledgerline.android.mirror.PullResult
import app.ledgerline.android.mirror.SyncLock
import app.ledgerline.android.mirror.attempt
import app.ledgerline.android.server.ServerAddressStore
import app.ledgerline.android.session.ClientsProvider
import app.ledgerline.api.SyncPush
import app.ledgerline.api.SyncPushResponse
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.withLock
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** Where batches go: the server, or a recording in tests. */
fun interface PushSource {
    suspend fun push(ledgerId: String, body: SyncPush): SyncPushResponse
}

class ApiPushSource @Inject constructor(
    private val addressStore: ServerAddressStore,
    private val clients: ClientsProvider,
) : PushSource {
    override suspend fun push(ledgerId: String, body: SyncPush): SyncPushResponse {
        val origin = addressStore.origin.first() ?: throw IOException("No server address is saved.")
        return clients.forSync(origin).api.push(ledgerId, body)
    }
}

@Module
@InstallIn(SingletonComponent::class)
abstract class PushSourceModule {
    @Binds
    abstract fun bindPushSource(source: ApiPushSource): PushSource
}

sealed interface PushResult {
    /** Everything pending was sent; [settled] changes were answered (some may now need the owner's attention). */
    data class Sent(val settled: Int) : PushResult

    /** Sending stopped early (no connection, signed out, a server error); what was not answered stays queued. */
    data class Stopped(val reason: PullResult) : PushResult
}

/**
 * Sends the outbox, oldest first, 50 changes at a time. A batch is marked as sent before it goes, and its changes
 * leave the outbox only with the server's answer, so a batch that is cut off is simply sent again: the server
 * recognises each change by its id and answers `replayed`. Shares the sync lock with the pull and the wipe.
 */
@Singleton
class PushEngine @Inject constructor(
    private val source: PushSource,
    private val outbox: OutboxStore,
    private val lock: SyncLock,
) {
    suspend fun send(ledgerId: String): PushResult = lock.mutex.withLock {
        var settled = 0
        repeat(MaxBatches) {
            val batch = when (val taken = attempt { outbox.takeBatch(ledgerId) }) {
                is Attempt.Done -> taken.value
                is Attempt.Stopped -> return@withLock PushResult.Stopped(taken.result)
            }
            if (batch.isEmpty()) return@withLock PushResult.Sent(settled)
            val reply = when (val sent = attempt { source.push(ledgerId, SyncPush(batch.map { it.toMutation() })) }) {
                is Attempt.Done -> sent.value
                is Attempt.Stopped -> return@withLock PushResult.Stopped(sent.result)
            }
            when (val done = attempt { outbox.settle(ledgerId, batch, reply.results) }) {
                is Attempt.Done -> settled += batch.size
                is Attempt.Stopped -> return@withLock PushResult.Stopped(done.result)
            }
        }
        PushResult.Stopped(PullResult.Failed)
    }

    companion object {
        const val MaxBatches = 1_000
    }
}
