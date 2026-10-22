package app.ledgerline.android.outbox

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class Uuid7Test {
    /** The server's id pattern (packages/shared idSchema): version 7, variant 8 to b. */
    private val serverPattern = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-7[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")

    @Test
    fun idsMatchTheServersPatternAndCarryTheTime() {
        val at = 1_792_657_934_422L
        val id = Uuid7.next(at)
        assertTrue(id, serverPattern.matches(id))
        assertEquals(at, id.replace("-", "").substring(0, 12).toLong(16))
    }

    @Test
    fun idsAreUnique() {
        val ids = (1..10_000).map { Uuid7.next(0) }
        assertEquals(ids.size, ids.toSet().size)
        assertTrue(ids.all { serverPattern.matches(it) })
    }
}
