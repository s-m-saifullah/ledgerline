package app.ledgerline.android.online

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** How an online write that did not finish is told to the person (ADR 0050), the same for every write. */
class WriteErrorTest {
    @Test
    fun aWriteThatWentThroughHasNoError() {
        assertNull(Written.Done("saved").toWriteError())
    }

    @Test
    fun everyOtherOutcomeHasItsOwnError() {
        assertEquals(WriteError.Offline, Written.Offline.toWriteError())
        assertEquals(WriteError.Forbidden, Written.Forbidden.toWriteError())
        assertEquals(WriteError.Failed, Written.Failed.toWriteError())
    }

    @Test
    fun aRefusalKeepsTheServersSentenceOrNone() {
        assertEquals(WriteError.Rejected("This budget changed. Reload and edit it."), Written.Rejected(409, "This budget changed. Reload and edit it.").toWriteError())
        assertEquals(WriteError.Rejected(null), Written.Rejected(422, null).toWriteError())
    }

    @Test
    fun aVersionThatMovedOnOrAThingThatIsGoneIsStale() {
        assertTrue(Written.Rejected(409, "changed").isStale())
        assertTrue(Written.Rejected(404, null).isStale())
    }

    @Test
    fun otherRefusalsAndOutcomesAreNotStale() {
        assertFalse(Written.Rejected(400, "bad").isStale())
        assertFalse(Written.Rejected(422, "bad").isStale())
        assertFalse(Written.Offline.isStale())
        assertFalse(Written.Forbidden.isStale())
        assertFalse(Written.Failed.isStale())
        assertFalse(Written.Done(Unit).isStale())
    }
}
