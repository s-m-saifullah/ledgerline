package app.ledgerline.android.online

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The `Idempotency-Key` a write carries (ADR 0050): made once per change, sent again unchanged on a retry. */
class WriteKeysTest {
    @Test
    fun theSameChangeGetsTheSameKeyEveryTime() {
        val keys = WriteKeys("pay")
        val first = keys.keyFor("pay|a1|1200")
        assertEquals(first, keys.keyFor("pay|a1|1200"))
        assertEquals(first, keys.keyFor("pay|a1|1200"))
    }

    @Test
    fun aChangedChangeGetsANewKey() {
        val keys = WriteKeys("pay")
        assertNotEquals(keys.keyFor("pay|a1|1200"), keys.keyFor("pay|a1|1300"))
    }

    @Test
    fun clearingForgetsEveryKeySoTheSameChangeStartsAgain() {
        val keys = WriteKeys("pay")
        val before = keys.keyFor("pay|a1|1200")
        val other = keys.keyFor("pay|a1|1300")
        keys.clear()
        assertNotEquals(before, keys.keyFor("pay|a1|1200"))
        assertNotEquals(other, keys.keyFor("pay|a1|1300"))
    }

    @Test
    fun aKeyStartsWithItsPrefix() {
        assertTrue(WriteKeys("bud").keyFor("x").startsWith("bud-"))
        assertTrue(WriteKeys("loan").keyFor("x").startsWith("loan-"))
    }

    @Test
    fun aKeyIsOneTheServerAccepts() {
        // docs/openapi.json and packages/shared: 8 to 128 characters from letters, digits and . _ : -
        val accepted = Regex("^[A-Za-z0-9._:-]{8,128}$")
        repeat(50) { assertTrue(accepted.matches(WriteKeys("pay").keyFor("change $it"))) }
    }

    @Test
    fun twoSetsOfKeysNeverShareAKeyForTheSameChange() {
        assertNotEquals(WriteKeys("pay").keyFor("same"), WriteKeys("pay").keyFor("same"))
    }

    @Test
    fun aLongChangeDescriptionDoesNotMakeALongKey() {
        // The change text only picks the key; it is never part of it, so an amount or a name cannot reach a header or a log.
        val key = WriteKeys("pay").keyFor("x".repeat(5_000))
        assertTrue(key.length <= 128)
        assertTrue("x".repeat(20) !in key)
    }
}
