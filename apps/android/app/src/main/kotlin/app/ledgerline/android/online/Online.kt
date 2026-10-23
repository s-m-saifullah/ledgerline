package app.ledgerline.android.online

import app.ledgerline.android.server.ServerAddressStore
import app.ledgerline.android.session.ClientsProvider
import app.ledgerline.android.session.SessionManager
import app.ledgerline.api.LedgerlineApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import kotlinx.serialization.SerializationException
import retrofit2.HttpException
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * What a screen read online shows (ADR 0043, slice 5). The answer lives in memory only; nothing read this way
 * is written to the phone.
 */
sealed interface Online<out T> {
    data object Loading : Online<Nothing>

    data class Ready<T>(val value: T) : Online<T>

    /** No connection to the server: the screen says so and offers Retry. */
    data object Offline : Online<Nothing>

    /** The server answered with an error or something this version cannot read. */
    data object Failed : Online<Nothing>
}

/** Reads one thing from the API with the open session. A refused token (401) ends the session, as the sync does. */
@Singleton
class OnlineReader @Inject constructor(
    private val addressStore: ServerAddressStore,
    private val clients: ClientsProvider,
    private val session: SessionManager,
) {
    suspend fun <T> read(call: suspend LedgerlineApi.() -> T): Online<T> {
        val origin = addressStore.origin.first() ?: return Online.Failed
        return try {
            Online.Ready(clients.forOrigin(origin).api.call())
        } catch (e: CancellationException) {
            throw e
        } catch (_: IOException) {
            Online.Offline
        } catch (e: HttpException) {
            if (e.code() == 401) session.tokenRejected()
            Online.Failed
        } catch (_: SerializationException) {
            Online.Failed
        }
    }
}

/** The same state with its answer changed, for a screen that shows part of what it read or reshapes it. */
fun <T, R> Online<T>.map(change: (T) -> R): Online<R> = when (this) {
    Online.Loading -> Online.Loading
    Online.Offline -> Online.Offline
    Online.Failed -> Online.Failed
    is Online.Ready -> Online.Ready(change(value))
}
