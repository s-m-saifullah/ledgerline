package app.ledgerline.android.online

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A sheet's "read again" counter goes up once per event; a screen that comes back sees the count as it was left (WP-19b). */
class RereadGateTest {
    @Test
    fun theCounterAtItsStartIsNotNews() {
        assertFalse(RereadGate().isNew(0))
    }

    @Test
    fun eachRiseIsNewOnceAndTheSameCountSeenAgainIsNot() {
        val gate = RereadGate()
        assertTrue(gate.isNew(1))
        assertFalse("the screen came back and saw 1 again", gate.isNew(1))
        assertTrue(gate.isNew(2))
        assertFalse(gate.isNew(2))
    }

    @Test
    fun aCountThatMovedByMoreThanOneIsOneEvent() {
        val gate = RereadGate()
        assertTrue(gate.isNew(3))
        assertFalse(gate.isNew(2))
        assertFalse(gate.isNew(3))
    }
}
