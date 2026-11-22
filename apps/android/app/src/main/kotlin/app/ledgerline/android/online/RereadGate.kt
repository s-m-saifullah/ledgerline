package app.ledgerline.android.online

/**
 * Whether the "read again" counter of a sheet has gone up since this screen last looked. A sheet's counter goes up once
 * per payment or move and is never reset, and its view model outlives the screen: a screen that comes back sees the count
 * as it was left, and must not read the client or person again for an event it already read for (WP-19b).
 */
class RereadGate {
    private var seen = 0

    fun isNew(count: Int): Boolean {
        if (count <= seen) return false
        seen = count
        return true
    }
}
