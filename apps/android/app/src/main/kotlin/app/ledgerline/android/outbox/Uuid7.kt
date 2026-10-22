package app.ledgerline.android.outbox

import java.security.SecureRandom

/** UUIDv7 ids made on the phone (RFC 9562): 48 bits of milliseconds, then random bits, version 7, variant 10. */
object Uuid7 {
    private val random = SecureRandom()

    fun next(nowMillis: Long = System.currentTimeMillis()): String {
        val bytes = ByteArray(16)
        random.nextBytes(bytes)
        for (i in 0..5) bytes[i] = (nowMillis ushr (40 - 8 * i)).toByte()
        bytes[6] = ((bytes[6].toInt() and 0x0f) or 0x70).toByte()
        bytes[8] = ((bytes[8].toInt() and 0x3f) or 0x80).toByte()
        val hex = bytes.joinToString("") { "%02x".format(it) }
        return "${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}"
    }
}
