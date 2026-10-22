package app.ledgerline.android.session

import app.ledgerline.android.testing.FakeClock
import app.ledgerline.android.testing.FakeTokenProtector
import app.ledgerline.api.SessionToken
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The rules of the session and the lock, with the phone's Keystore replaced by a fake. */
class SessionManagerTest {
    private val clock = FakeClock()
    private val protector = FakeTokenProtector()
    private val token = SessionToken("tok-1")

    private fun manager(p: FakeTokenProtector = protector) = SessionManager(p, clock)

    @Test
    fun startsSignedOutWhenNothingIsStored() = assertEquals(SessionState.SignedOut, manager().state.value)

    @Test
    fun startsLockedWhenATokenIsStoredAndHoldsNoTokenInMemory() {
        val m = manager(FakeTokenProtector(stored = token))
        assertEquals(SessionState.Locked, m.state.value)
        assertNull(m.token.value)
    }

    @Test
    fun aSignInOffersToKeepTheSessionAndStoresNothingYet() {
        val m = manager()
        m.signedIn(token)
        assertEquals(SessionState.Offer, m.state.value)
        assertEquals(token, m.token.value)
        assertFalse(protector.hasStored())
    }

    @Test
    fun confirmingStoresTheTokenAndUnlocks() = runBlocking {
        val m = manager()
        m.signedIn(token)
        assertEquals(ProtectOutcome.Saved, m.protect())
        assertEquals(SessionState.Unlocked, m.state.value)
        assertTrue(protector.hasStored())
    }

    @Test
    fun aCancelledOrFailedConfirmationStoresNothingAndStaysOnTheOffer() = runBlocking {
        for (result in listOf(ProtectOutcome.Cancelled, ProtectOutcome.Failed(), ProtectOutcome.Failed(lockedOut = true))) {
            val p = FakeTokenProtector().also { it.protectResult = result }
            val m = manager(p)
            m.signedIn(token)
            assertEquals(result, m.protect())
            assertEquals(SessionState.Offer, m.state.value)
            assertFalse(p.hasStored())
            assertEquals(token, m.token.value)
        }
    }

    @Test
    fun notNowKeepsTheSessionInMemoryOnly() {
        val m = manager()
        m.signedIn(token)
        m.skipProtect()
        assertEquals(SessionState.Unlocked, m.state.value)
        assertFalse(protector.hasStored())
        assertFalse(m.canLock())
    }

    @Test
    fun lockingForgetsTheOpenTokenButKeepsTheStoredOne() = runBlocking {
        val m = manager()
        m.signedIn(token)
        m.protect()
        assertTrue(m.canLock())
        m.lock()
        assertEquals(SessionState.Locked, m.state.value)
        assertNull(m.token.value)
        assertTrue(protector.hasStored())
    }

    @Test
    fun lockingAMemoryOnlySessionSignsOut() {
        val m = manager()
        m.signedIn(token)
        m.skipProtect()
        m.lock()
        assertEquals(SessionState.SignedOut, m.state.value)
        assertNull(m.token.value)
    }

    @Test
    fun unlockingOpensTheStoredToken() = runBlocking {
        val m = manager(FakeTokenProtector(stored = token))
        assertEquals(UnlockOutcome.Unlocked(token), m.unlock())
        assertEquals(SessionState.Unlocked, m.state.value)
        assertEquals(token, m.token.value)
    }

    @Test
    fun aCancelledOrFailedUnlockStaysLockedAndKeepsTheStoredToken() = runBlocking {
        for (result in listOf(UnlockOutcome.Cancelled, UnlockOutcome.Failed(), UnlockOutcome.Failed(lockedOut = true))) {
            val p = FakeTokenProtector(stored = token).also { it.unlockResult = result }
            val m = manager(p)
            assertEquals(result, m.unlock())
            assertEquals(SessionState.Locked, m.state.value)
            assertNull(m.token.value)
            assertTrue(p.hasStored())
            assertEquals(0, p.discardCount)
        }
    }

    @Test
    fun aLostKeySignsOutWithANoticeAndDeletesOnlyTheLocalCopy() = runBlocking {
        val p = FakeTokenProtector(stored = token).also { it.unlockResult = UnlockOutcome.KeyLost }
        val m = manager(p)
        m.unlock()
        assertEquals(SessionState.SignedOut, m.state.value)
        assertEquals(SessionEnd.KeyLost, m.ended.value)
        assertFalse(p.hasStored())
        assertNull(m.token.value)
        m.noticeShown()
        assertNull(m.ended.value)
    }

    @Test
    fun signInAgainWhileLockedNeedsNoOldToken() = runBlocking {
        val p = FakeTokenProtector(stored = token)
        val m = manager(p)
        m.endSession()
        assertEquals(SessionState.SignedOut, m.state.value)
        assertFalse(p.hasStored())
        m.signedIn(SessionToken("tok-2"))
        assertEquals(SessionState.Offer, m.state.value)
    }

    @Test
    fun endingASessionDeletesTheStoredTokenAndRecordsWhy() = runBlocking {
        val m = manager()
        m.signedIn(token)
        m.protect()
        m.endSession(SessionEnd.Expired)
        assertFalse(protector.hasStored())
        assertNull(m.token.value)
        assertEquals(SessionEnd.Expired, m.ended.value)
        assertEquals(SessionState.SignedOut, m.state.value)
    }

    @Test
    fun aNewSignInClearsTheOldNotice() {
        val m = manager()
        m.endSession(SessionEnd.KeyLost)
        m.signedIn(token)
        assertNull(m.ended.value)
    }

    @Test
    fun theAppLocksOnlyAfterSixtySecondsInTheBackground() = runBlocking {
        val m = manager()
        m.signedIn(token)
        m.protect()

        clock.now = 1_000
        m.appWentToBackground()
        clock.now = 1_000 + LockAfterMillis - 1
        m.appCameToForeground()
        assertEquals(SessionState.Unlocked, m.state.value)

        clock.now = 100_000
        m.appWentToBackground()
        clock.now = 100_000 + LockAfterMillis
        m.appCameToForeground()
        assertEquals(SessionState.Locked, m.state.value)
        assertNull(m.token.value)
    }

    @Test
    fun comingToTheForegroundWithoutHavingLeftDoesNothing() = runBlocking {
        val m = manager()
        m.signedIn(token)
        m.protect()
        clock.now = 10 * LockAfterMillis
        m.appCameToForeground()
        assertEquals(SessionState.Unlocked, m.state.value)
    }

    @Test
    fun protectingWithoutATokenFailsAndUnlockingWhenNotLockedDoesNothing() = runBlocking {
        val m = manager()
        assertEquals(ProtectOutcome.Failed(), m.protect())
        m.signedIn(token)
        m.skipProtect()
        assertEquals(UnlockOutcome.Failed(), m.unlock())
        assertEquals(SessionState.Unlocked, m.state.value)
    }

    @Test
    fun theProtectionOfThePhoneIsPassedOn() {
        protector.protection = Protection.NoScreenLock
        assertEquals(Protection.NoScreenLock, manager().protection())
    }
}
