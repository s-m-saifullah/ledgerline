package app.ledgerline.android.online

import app.ledgerline.android.drafts.Draft
import app.ledgerline.android.outbox.Uuid7
import java.security.MessageDigest

/**
 * The `Idempotency-Key` of each change a screen writes (ADR 0050). A change that is sent again, because the first
 * answer was lost or the person tapped again, must carry the key it had, so the server does it once; a changed change
 * gets a new key. [change] only picks the key: it is never part of it, so an amount or a name cannot reach a header
 * or a log. Clear the keys when a write finishes or its sheet closes.
 *
 * With a [saved] draft the keys survive Android ending the app in the background (WP-18b): the same change sent again after
 * the restart carries the key it had, so a payment whose answer was lost is still done once.
 *
 * The server accepts 8 to 128 characters from letters, digits and `. _ : -`; a key is [prefix], a dash and a UUIDv7.
 */
class WriteKeys(private val prefix: String, private val saved: Draft<Map<String, String>>? = null) {
    // By what a change hashes to, so the kept copy never holds the change's own text (an amount, a name).
    private val keys = saved?.load()?.toMutableMap() ?: mutableMapOf()

    fun keyFor(change: String): String {
        val id = fingerprint(change)
        val known = keys[id]
        if (known != null) return known
        return "$prefix-${Uuid7.next()}".also {
            keys[id] = it
            saved?.save(keys.toMap())
        }
    }

    fun clear() {
        keys.clear()
        saved?.save(null)
    }

    private fun fingerprint(change: String) =
        MessageDigest.getInstance("SHA-256").digest(change.toByteArray()).joinToString("") { "%02x".format(it) }
}
