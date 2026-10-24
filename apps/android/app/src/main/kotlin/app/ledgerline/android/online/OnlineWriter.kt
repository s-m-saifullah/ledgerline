package app.ledgerline.android.online

import app.ledgerline.android.server.ServerAddressStore
import app.ledgerline.android.session.ClientsProvider
import app.ledgerline.android.session.SessionManager
import app.ledgerline.api.LedgerlineApi
import app.ledgerline.api.parseProblem
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import kotlinx.serialization.SerializationException
import retrofit2.HttpException
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** How an online write ended (ADR 0043). Nothing is queued: a write that did not happen is for the owner to try again. */
sealed interface Written<out T> {
    data class Done<T>(val value: T) : Written<T>

    /** No connection, or the reply was lost: the same write may or may not have happened. Trying again with the same key is safe. */
    data object Offline : Written<Nothing>

    /** The server refused the change (a duplicate name, a version that moved on, ...) and said why in a fixed sentence. */
    data class Rejected(val status: Int, val detail: String?) : Written<Nothing>

    /** The signed-in account may not change this ledger (a viewer). */
    data object Forbidden : Written<Nothing>

    /** The server failed, or answered with something this version cannot read. */
    data object Failed : Written<Nothing>
}

/** Sends one write to the API with the open session. A refused token (401) ends the session, as the sync and reads do. */
@Singleton
class OnlineWriter @Inject constructor(
    private val addressStore: ServerAddressStore,
    private val clients: ClientsProvider,
    private val session: SessionManager,
) {
    suspend fun <T> write(call: suspend LedgerlineApi.() -> T): Written<T> {
        val origin = addressStore.origin.first() ?: return Written.Failed
        return try {
            Written.Done(clients.forOrigin(origin).api.call())
        } catch (e: CancellationException) {
            throw e
        } catch (_: IOException) {
            Written.Offline
        } catch (e: HttpException) {
            when (e.code()) {
                401 -> {
                    session.tokenRejected()
                    Written.Failed
                }
                403 -> Written.Forbidden
                400, 404, 409, 422 -> Written.Rejected(e.code(), parseProblem(e.response()?.errorBody()?.string())?.detail)
                else -> Written.Failed
            }
        } catch (_: SerializationException) {
            Written.Failed
        }
    }
}
