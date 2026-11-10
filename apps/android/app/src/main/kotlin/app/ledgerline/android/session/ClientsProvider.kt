package app.ledgerline.android.session

import android.os.Build
import app.ledgerline.android.BuildConfig
import app.ledgerline.api.LedgerlineClients
import app.ledgerline.api.SessionToken
import app.ledgerline.api.appUserAgent
import app.ledgerline.api.createClients
import javax.inject.Inject
import javax.inject.Singleton

/** The HTTP clients for the saved server address; rebuilt only when the address changes. */
@Singleton
class ClientsProvider @Inject constructor(private val session: SessionManager) {
    private var cached: Pair<String, LedgerlineClients>? = null

    private var cachedSync: Pair<String, LedgerlineClients>? = null

    /** Clients for the background sync: they may use the stored token while the app is locked (ADR 0043). */
    @Synchronized
    fun forSync(origin: String): LedgerlineClients {
        cachedSync?.takeIf { it.first == origin }?.let { return it.second }
        val clients = createClients(
            origin = origin,
            userAgent = appUserAgent(BuildConfig.VERSION_NAME, Build.MODEL.orEmpty()),
            token = { session.tokenForSync()?.value },
        )
        cachedSync = origin to clients
        return clients
    }

    /**
     * Clients that send [token] instead of the session's, for the one question asked right after a sign-in, before the
     * session accepts the token (ADR 0050). Not kept: the token goes out of scope with the answer.
     */
    fun forToken(origin: String, token: SessionToken): LedgerlineClients = createClients(
        origin = origin,
        userAgent = appUserAgent(BuildConfig.VERSION_NAME, Build.MODEL.orEmpty()),
        token = { token.value },
    )

    @Synchronized
    fun forOrigin(origin: String): LedgerlineClients {
        cached?.takeIf { it.first == origin }?.let { return it.second }
        val clients = createClients(
            origin = origin,
            userAgent = appUserAgent(BuildConfig.VERSION_NAME, Build.MODEL.orEmpty()),
            token = { session.token.value?.value },
        )
        cached = origin to clients
        return clients
    }
}
