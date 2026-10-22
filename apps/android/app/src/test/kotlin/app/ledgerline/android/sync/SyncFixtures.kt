package app.ledgerline.android.sync

import app.ledgerline.android.mirror.PullSource
import app.ledgerline.api.SyncResponse
import kotlinx.coroutines.CompletableDeferred

class FakeScheduler : SyncScheduler {
    var scheduled = 0
    var cancelled = 0

    override fun schedule() {
        scheduled++
    }

    override fun cancel() {
        cancelled++
    }
}

class FakeLedgerChoice(var id: String? = null) : LedgerChoice {
    override fun get() = id

    override fun set(ledgerId: String) {
        id = ledgerId
    }

    override fun clear() {
        id = null
    }
}

class FakeLookup(var result: () -> String? = { "ledger-a" }) : LedgerLookup {
    var calls = 0

    override suspend fun firstLedgerId(): String? {
        calls++
        return result()
    }
}

/** Answers every pull with [respond], and can hold one pull open until the test lets it go. */
class HoldableSource(var respond: (String?) -> SyncResponse) : PullSource {
    val asked = mutableListOf<String?>()
    var hold: CompletableDeferred<Unit>? = null
    var entered = CompletableDeferred<Unit>()

    override suspend fun pull(ledgerId: String, cursor: String?, limit: Int): SyncResponse {
        asked += cursor
        entered.complete(Unit)
        hold?.await()
        return respond(cursor)
    }
}
