package app.ledgerline.android.session

import android.os.Build
import app.ledgerline.android.BuildConfig
import app.ledgerline.api.LedgerlineClients
import app.ledgerline.api.appUserAgent
import app.ledgerline.api.createClients
import javax.inject.Inject
import javax.inject.Singleton

/** The HTTP clients for the saved server address; rebuilt only when the address changes. */
@Singleton
class ClientsProvider @Inject constructor(private val session: SessionManager) {
    private var cached: Pair<String, LedgerlineClients>? = null

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
