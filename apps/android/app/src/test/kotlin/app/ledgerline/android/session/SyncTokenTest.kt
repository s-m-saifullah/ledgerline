package app.ledgerline.android.session

import app.ledgerline.android.testing.FakeClock
import app.ledgerline.android.testing.FakeTokenProtector
import app.ledgerline.api.SessionToken
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** What the background sync may read, and what a 401 does to the session. */
class SyncTokenTest {
    private val token = SessionToken("tok-1")

    @Test
    fun theStoredTokenIsReadWithoutAPromptWhileLocked() {
        val protector = FakeTokenProtector(stored = token)
        val m = SessionManager(protector, FakeClock())
        assertEquals(SessionState.Locked, m.state.value)
        assertNull(m.token.value)
        assertEquals(token, m.tokenForSync())
        assertEquals(0, protector.unlockPrompts)
        assertNull(m.token.value)
        assertEquals(SessionState.Locked, m.state.value)
    }

    @Test
    fun theOpenTokenIsUsedWithoutReadingTheStoredOne() {
        val protector = FakeTokenProtector(stored = token)
        val m = SessionManager(protector, FakeClock())
        m.signedIn(SessionToken("open"))
        assertEquals("open", m.tokenForSync()?.value)
        assertEquals(0, protector.syncReads)
    }

    @Test
    fun noTokenWhenNothingIsStoredOrThePhoneHasNoScreenLock() {
        assertNull(SessionManager(FakeTokenProtector(), FakeClock()).tokenForSync())
        val noLock = FakeTokenProtector(protection = Protection.NoScreenLock, stored = token)
        assertNull(SessionManager(noLock, FakeClock()).tokenForSync())
    }

    @Test
    fun aRejectedTokenEndsTheSessionOnceAsExpiredAndDeletesTheStoredCopy() {
        val protector = FakeTokenProtector(stored = token)
        val m = SessionManager(protector, FakeClock())
        m.tokenRejected()
        assertEquals(SessionState.SignedOut, m.state.value)
        assertEquals(SessionEnd.Expired, m.ended.value)
        assertEquals(1, protector.discardCount)
        m.tokenRejected()
        assertEquals(1, protector.discardCount)
    }

    @Test
    fun aRejectedTokenAfterASignOutAddsNoNotice() {
        val m = SessionManager(FakeTokenProtector(stored = token), FakeClock())
        m.endSession(null)
        m.tokenRejected()
        assertNull(m.ended.value)
    }
}
