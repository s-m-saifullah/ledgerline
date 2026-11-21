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

    // A restart (Android ending the app in the background) must not turn a retry into a second payment: the key a change
    // had is kept with the form, so the same change sent again after the restart carries the same key (WP-18b).
    private fun restarted(handle: androidx.lifecycle.SavedStateHandle) =
        androidx.lifecycle.SavedStateHandle(handle.keys().associateWith { handle.get<Any>(it) })

    private fun kept(handle: androidx.lifecycle.SavedStateHandle) =
        WriteKeys("pay", app.ledgerline.android.drafts.Draft(handle, "keys", kotlinx.serialization.builtins.MapSerializer(kotlinx.serialization.serializer<String>(), kotlinx.serialization.serializer<String>())))

    @Test
    fun theKeyOfAChangeSurvivesARestart() {
        val handle = androidx.lifecycle.SavedStateHandle()
        val before = kept(handle).keyFor("pay|a1|1200")
        assertEquals(before, kept(restarted(handle)).keyFor("pay|a1|1200"))
    }

    @Test
    fun aChangedChangeStillGetsANewKeyAfterARestart() {
        val handle = androidx.lifecycle.SavedStateHandle()
        val before = kept(handle).keyFor("pay|a1|1200")
        assertNotEquals(before, kept(restarted(handle)).keyFor("pay|a1|1300"))
    }

    @Test
    fun clearedKeysDoNotComeBackAfterARestart() {
        val handle = androidx.lifecycle.SavedStateHandle()
        val keys = kept(handle)
        val before = keys.keyFor("pay|a1|1200")
        keys.clear()
        assertNotEquals(before, kept(restarted(handle)).keyFor("pay|a1|1200"))
        assertEquals(emptySet<String>(), handle.keys())
    }

    @Test
    fun theTextOfAChangeIsNeverKeptOnlyWhichKeyItGot() {
        val handle = androidx.lifecycle.SavedStateHandle()
        kept(handle).keyFor("pay|a1|1200|a private note")
        val stored = handle.keys().joinToString { handle.get<String>(it).orEmpty() }
        assertTrue(!stored.contains("private") && !stored.contains("1200"))
    }
}
