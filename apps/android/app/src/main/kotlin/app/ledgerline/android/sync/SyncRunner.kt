package app.ledgerline.android.sync

import app.ledgerline.android.mirror.PullResult
import app.ledgerline.android.mirror.SyncEngine
import app.ledgerline.android.mirror.Attempt
import app.ledgerline.android.mirror.attempt
import app.ledgerline.android.server.ServerAddressStore
import app.ledgerline.android.session.ClientsProvider
import app.ledgerline.android.session.SessionManager
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.flow.first
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** Finds the ledger to mirror: the first one the server lists. */
fun interface LedgerLookup {
    suspend fun firstLedgerId(): String?
}

class ApiLedgerLookup @Inject constructor(
    private val addressStore: ServerAddressStore,
    private val clients: ClientsProvider,
) : LedgerLookup {
    override suspend fun firstLedgerId(): String? {
        val origin = addressStore.origin.first() ?: throw IOException("No server address is saved.")
        return clients.forSync(origin).api.ledgers().items.firstOrNull()?.id
    }
}

@Module
@InstallIn(SingletonComponent::class)
abstract class LedgerLookupModule {
    @Binds
    abstract fun bindLedgerLookup(lookup: ApiLedgerLookup): LedgerLookup

    @Binds
    abstract fun bindLedgerChoice(choice: PrefsLedgerChoice): LedgerChoice
}

/** One pull of the chosen ledger: works out which ledger it is, then runs the engine. */
@Singleton
class SyncRunner @Inject constructor(
    private val engine: SyncEngine,
    private val lookup: LedgerLookup,
    private val choice: LedgerChoice,
    private val session: SessionManager,
) {
    /** [fullRefresh] replaces the mirror instead of continuing from the saved cursor. */
    suspend fun run(fullRefresh: Boolean = false): PullResult {
        // No readable token (nothing stored, or the phone's screen lock is gone): nothing to do, nothing is ended
        // here; the lock screen decides what a lost key means.
        if (session.tokenForSync() == null) return PullResult.Failed
        val ledgerId = choice.get() ?: when (val found = attempt { lookup.firstLedgerId() }) {
            is Attempt.Done -> found.value?.also { choice.set(it) } ?: return PullResult.Failed
            is Attempt.Stopped -> return found.result
        }
        val result = if (fullRefresh) engine.refreshEverything(ledgerId) else engine.pull(ledgerId)
        if (result == PullResult.NotFound) choice.clear()
        return result
    }
}
