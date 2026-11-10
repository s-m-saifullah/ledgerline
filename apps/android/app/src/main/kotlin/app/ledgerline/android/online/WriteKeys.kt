package app.ledgerline.android.online

import app.ledgerline.android.outbox.Uuid7

/**
 * The `Idempotency-Key` of each change a screen writes (ADR 0050). A change that is sent again, because the first
 * answer was lost or the person tapped again, must carry the key it had, so the server does it once; a changed change
 * gets a new key. [change] only picks the key: it is never part of it, so an amount or a name cannot reach a header
 * or a log. Clear the keys when a write finishes or its sheet closes.
 *
 * The server accepts 8 to 128 characters from letters, digits and `. _ : -`; a key is [prefix], a dash and a UUIDv7.
 */
class WriteKeys(private val prefix: String) {
    private val keys = mutableMapOf<String, String>()

    fun keyFor(change: String): String = keys.getOrPut(change) { "$prefix-${Uuid7.next()}" }

    fun clear() = keys.clear()
}
