package app.ledgerline.android.mirror

import app.ledgerline.android.server.ServerAddressStore
import app.ledgerline.android.session.ClientsProvider
import app.ledgerline.api.SyncResponse
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.withLock
import retrofit2.HttpException
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** Where pages come from: the server, or a recording in tests. */
fun interface PullSource {
    suspend fun pull(ledgerId: String, cursor: String?, limit: Int): SyncResponse
}

class ApiPullSource @Inject constructor(
    private val addressStore: ServerAddressStore,
    private val clients: ClientsProvider,
) : PullSource {
    override suspend fun pull(ledgerId: String, cursor: String?, limit: Int): SyncResponse {
        val origin = addressStore.origin.first() ?: throw IOException("No server address is saved.")
        return clients.forSync(origin).api.sync(ledgerId, cursor, limit)
    }
}

@Module
@InstallIn(SingletonComponent::class)
abstract class PullSourceModule {
    @Binds
    abstract fun bindPullSource(source: ApiPullSource): PullSource
}

sealed interface PullResult {
    /** The mirror now matches the server as of [serverTime]. */
    data class Updated(val fullRefresh: Boolean, val serverTime: String) : PullResult

    /** The server refused the token (401). The mirror is left as it is; the owner must sign in again. */
    data object SignedOut : PullResult

    /** The server could not be reached; try again later. Nothing changed. */
    data object Offline : PullResult

    /** The server does not know this ledger (404, or no longer a member): the choice must be made again. */
    data object NotFound : PullResult

    /** Anything else (a server error, a reply the app cannot read). Nothing changed. */
    data object Failed : PullResult
}

/**
 * Brings the mirror of one ledger up to date with the pull (ADR 0042, 0043). No stored cursor, or a cursor the server
 * rejects, means a full refresh; otherwise pages are applied one by one, each with its cursor. One pull at a time.
 * Never logs anything from the pages.
 */
@Singleton
class SyncEngine @Inject constructor(
    private val source: PullSource,
    private val store: MirrorStore,
    lock: SyncLock,
) {
    private val oneAtATime = lock.mutex

    suspend fun pull(ledgerId: String): PullResult = oneAtATime.withLock {
        guarded {
            val stored = store.cursor(ledgerId)
            if (stored == null) refresh(ledgerId) else incremental(ledgerId, stored.cursor)
        }
    }

    /** Forces a full refresh, for "Refresh everything" and after signing in. */
    suspend fun refreshEverything(ledgerId: String): PullResult = oneAtATime.withLock {
        guarded { refresh(ledgerId) }
    }

    /**
     * Deletes the whole mirror (sign-out). It waits for a pull in progress, so a page that is being written cannot
     * land after the wipe.
     */
    suspend fun wipe() = oneAtATime.withLock { store.wipe() }

    private suspend fun incremental(ledgerId: String, start: String): PullResult {
        var cursor = start
        repeat(MaxPages) {
            val page = try {
                source.pull(ledgerId, cursor, PageSize)
            } catch (e: HttpException) {
                // The server did not make this cursor (400): start over rather than guess.
                if (e.code() == 400) return refresh(ledgerId) else throw e
            }
            store.applyPage(ledgerId, page.changes.toRows(ledgerId), page.cursor, page.serverTime)
            if (!page.hasMore) return PullResult.Updated(fullRefresh = false, serverTime = page.serverTime)
            if (page.cursor == cursor) return PullResult.Failed
            cursor = page.cursor
        }
        return PullResult.Failed
    }

    /** Reads every page first and writes only when the last one has arrived, so a failure changes nothing. */
    private suspend fun refresh(ledgerId: String): PullResult {
        val pages = mutableListOf<MirrorRows>()
        var cursor: String? = null
        repeat(MaxPages) {
            val page = source.pull(ledgerId, cursor, PageSize)
            pages += page.changes.toRows(ledgerId)
            if (!page.hasMore) {
                store.replaceAll(ledgerId, MirrorRows.merge(pages), page.cursor, page.serverTime)
                return PullResult.Updated(fullRefresh = true, serverTime = page.serverTime)
            }
            if (page.cursor == cursor) return PullResult.Failed
            cursor = page.cursor
        }
        return PullResult.Failed
    }

    companion object {
        const val PageSize = 500
        const val MaxPages = 10_000
    }
}

/** What a call to the server came to: its value, or the [PullResult] that says why it did not finish. */
sealed interface Attempt<out T> {
    data class Done<T>(val value: T) : Attempt<T>
    data class Stopped(val result: PullResult) : Attempt<Nothing>
}

/** Runs [block] and turns the failures a pull can have into a [PullResult]; cancellation passes through. */
suspend fun <T> attempt(block: suspend () -> T): Attempt<T> = try {
    Attempt.Done(block())
} catch (e: CancellationException) {
    throw e
} catch (e: HttpException) {
    Attempt.Stopped(
        when (e.code()) {
            401 -> PullResult.SignedOut
            404 -> PullResult.NotFound
            else -> PullResult.Failed
        },
    )
} catch (_: IOException) {
    Attempt.Stopped(PullResult.Offline)
} catch (_: Exception) {
    Attempt.Stopped(PullResult.Failed)
}

suspend fun guarded(block: suspend () -> PullResult): PullResult = when (val done = attempt(block)) {
    is Attempt.Done -> done.value
    is Attempt.Stopped -> done.result
}
