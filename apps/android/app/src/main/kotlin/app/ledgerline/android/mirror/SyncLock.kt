package app.ledgerline.android.mirror

import kotlinx.coroutines.sync.Mutex
import javax.inject.Inject
import javax.inject.Singleton

/** One sync at a time: a pull, a push and the sign-out wipe never overlap, so nothing lands after a wipe. */
@Singleton
class SyncLock @Inject constructor() {
    val mutex = Mutex()
}
