package app.ledgerline.android.sync

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.ledgerline.android.mirror.MirrorDatabase
import app.ledgerline.android.mirror.MirrorStore
import app.ledgerline.android.mirror.PullResult
import app.ledgerline.android.mirror.SyncEngine
import app.ledgerline.android.mirror.account
import app.ledgerline.android.mirror.changes
import app.ledgerline.android.mirror.httpError
import app.ledgerline.android.mirror.page
import app.ledgerline.android.mirror.toRows
import app.ledgerline.android.session.SessionEnd
import app.ledgerline.android.session.SessionManager
import app.ledgerline.android.session.SessionState
import app.ledgerline.android.testing.FakeClock
import app.ledgerline.android.testing.FakeTokenProtector
import app.ledgerline.api.SessionToken
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException

/** When the mirror is pulled and when it is deleted, driven by the real session rules over a fake keystore. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SyncCoordinatorTest {
    private lateinit var database: MirrorDatabase
    private val clock = FakeClock()
    private val scheduler = FakeScheduler()
    private val choice = FakeLedgerChoice()
    private val lookup = FakeLookup()
    private val token = SessionToken("tok-1")
    private val source = HoldableSource { page(changes(accounts = listOf(account(1))), cursor = "c1") }

    @Before
    fun open() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, MirrorDatabase::class.java).allowMainThreadQueries().build()
    }

    @After
    fun close() = database.close()

    private fun build(protector: FakeTokenProtector): Pair<SessionManager, SyncCoordinator> {
        val session = SessionManager(protector, clock)
        val engine = SyncEngine(source, MirrorStore(database))
        return session to SyncCoordinator(session, SyncRunner(engine, lookup, choice, session), engine, scheduler, choice, clock)
    }

    private suspend fun rows() = database.dao().allAccounts("ledger-a")

    /** Signs in, keeps the session on the phone and lets the coordinator see each state. */
    private suspend fun signedInAndKept(protector: FakeTokenProtector = FakeTokenProtector()): Pair<SessionManager, SyncCoordinator> {
        val (session, sync) = build(protector)
        session.signedIn(token)
        sync.onState(session.state.value)
        session.protect()
        sync.onState(session.state.value)
        return session to sync
    }

    @Test
    fun aSignInFullyRefreshesOnceAndSchedulesTheBackgroundPull() = runBlocking {
        val (_, sync) = signedInAndKept()
        assertEquals(listOf<String?>(null), source.asked)
        assertEquals(listOf(app.ledgerline.android.mirror.id(1)), rows().map { it.id })
        assertEquals("ledger-a", choice.id)
        assertEquals(1, scheduler.scheduled)
        assertEquals(PullResult.Updated(true, app.ledgerline.android.mirror.Stamp), sync.last.value)
    }

    @Test
    fun aSessionNotKeptStillPullsButHasNoBackgroundJob() = runBlocking {
        val (session, sync) = build(FakeTokenProtector())
        session.signedIn(token)
        sync.onState(session.state.value)
        session.skipProtect()
        sync.onState(session.state.value)
        assertEquals(1, source.asked.size)
        assertEquals(0, scheduler.scheduled)
        assertEquals(1, scheduler.cancelled)
    }

    @Test
    fun startingLockedSchedulesButPullsNothing() = runBlocking {
        val (session, sync) = build(FakeTokenProtector(stored = token))
        sync.onState(session.state.value)
        assertEquals(SessionState.Locked, session.state.value)
        assertEquals(1, scheduler.scheduled)
        assertTrue(source.asked.isEmpty())
    }

    @Test
    fun theBackgroundPullWorksWhileLockedWithoutAPrompt() = runBlocking {
        val protector = FakeTokenProtector(stored = token)
        val (session, sync) = build(protector)
        assertEquals(BackgroundOutcome.Done, sync.backgroundPull(0))
        assertEquals(SessionState.Locked, session.state.value)
        assertEquals(0, protector.unlockPrompts)
        assertEquals(1, rows().size)
    }

    @Test
    fun theBackgroundPullDoesNothingAfterASignOutAndCancelsItself() = runBlocking {
        val (_, sync) = build(FakeTokenProtector())
        assertEquals(BackgroundOutcome.Stop, sync.backgroundPull(0))
        assertEquals(1, scheduler.cancelled)
        assertTrue(source.asked.isEmpty())
    }

    @Test
    fun backgroundFailuresRetryAWhileThenWaitForTheNextPeriod() = runBlocking {
        val protector = FakeTokenProtector(stored = token)
        val (_, sync) = build(protector)
        source.respond = { throw IOException("offline") }
        assertEquals(BackgroundOutcome.Retry, sync.backgroundPull(0))
        assertEquals(BackgroundOutcome.Retry, sync.backgroundPull(2))
        assertEquals(BackgroundOutcome.Done, sync.backgroundPull(SyncCoordinator.MaxBackgroundRetries))
    }

    @Test
    fun aRefusedTokenEndsTheSessionAsExpiredAndKeepsTheMirror() = runBlocking {
        val (session, sync) = signedInAndKept()
        source.respond = { throw httpError(401) }
        sync.refreshEverything()
        assertEquals(SessionState.SignedOut, session.state.value)
        assertEquals(SessionEnd.Expired, session.ended.value)
        sync.onState(session.state.value)
        assertEquals(1, rows().size)
        assertEquals("ledger-a", database.dao().cursor("ledger-a")?.ledgerId)
    }

    @Test
    fun aBackgroundRefusalStopsTheJobAndEndsTheSessionOnce() = runBlocking {
        val protector = FakeTokenProtector(stored = token)
        val (session, sync) = build(protector)
        source.respond = { throw httpError(401) }
        assertEquals(BackgroundOutcome.Stop, sync.backgroundPull(0))
        assertEquals(SessionEnd.Expired, session.ended.value)
        assertEquals(1, protector.discardCount)
        sync.onState(session.state.value)
        assertEquals(1, scheduler.cancelled)
    }

    @Test
    fun signingOutDeletesTheMirrorTheChoiceAndTheJob() = runBlocking {
        val (session, sync) = signedInAndKept()
        assertEquals(1, rows().size)
        session.endSession(null)
        sync.onState(session.state.value)
        assertTrue(rows().isEmpty())
        assertNull(database.dao().cursor("ledger-a"))
        assertNull(choice.id)
        assertEquals(1, scheduler.cancelled)
    }

    @Test
    fun signingOutWithoutReachingTheServerStillDeletesTheMirror() = runBlocking {
        val (session, sync) = signedInAndKept()
        session.endSession(SessionEnd.ServerNotReached)
        sync.onState(session.state.value)
        assertTrue(rows().isEmpty())
    }

    @Test
    fun aLostKeyDeletesTheMirror() = runBlocking {
        val (session, sync) = signedInAndKept()
        session.lock()
        sync.onState(session.state.value)
        session.endSession(SessionEnd.KeyLost)
        sync.onState(session.state.value)
        assertTrue(rows().isEmpty())
    }

    @Test
    fun theFirstLookAtASignedOutAppDeletesNothing() = runBlocking {
        val (session, sync) = build(FakeTokenProtector())
        MirrorStore(database).replaceAll("ledger-a", changes(accounts = listOf(account(1))).toRows("ledger-a"), "c", app.ledgerline.android.mirror.Stamp)
        sync.onState(session.state.value)
        assertEquals(1, rows().size)
        assertEquals(1, scheduler.cancelled)
    }

    @Test
    fun aSignOutWaitsForAPullInProgressSoNothingReappears() = runBlocking {
        val (session, sync) = build(FakeTokenProtector())
        session.signedIn(token)
        sync.onState(session.state.value)
        session.skipProtect()
        source.hold = CompletableDeferred()
        val pulling = launch { sync.onState(session.state.value) }
        source.entered.await()
        session.endSession(null)
        val wiping = launch { sync.onState(session.state.value) }
        source.hold!!.complete(Unit)
        pulling.join()
        wiping.join()
        assertTrue(rows().isEmpty())
    }

    @Test
    fun aNewSignInStartsAFullRefreshAndForgetsTheOldLedgerChoice() = runBlocking {
        val (session, sync) = signedInAndKept()
        session.endSession(SessionEnd.Expired)
        sync.onState(session.state.value)
        choice.id = "old-ledger"
        lookup.result = { "ledger-a" }
        source.asked.clear()
        session.signedIn(token)
        sync.onState(session.state.value)
        assertNull(choice.id)
        session.skipProtect()
        sync.onState(session.state.value)
        assertEquals(listOf<String?>(null), source.asked)
        assertEquals("ledger-a", choice.id)
    }

    @Test
    fun theAppOpeningPullsOnlyWhenUnlockedAndNotMoreOftenThanEvery30Seconds() = runBlocking {
        val (session, sync) = signedInAndKept()
        source.asked.clear()
        clock.now = 10_000
        sync.foregroundPull()
        assertTrue(source.asked.isEmpty())
        clock.now = 31_000
        sync.foregroundPull()
        assertEquals(1, source.asked.size)
        assertEquals("c1", source.asked.single())
        session.lock()
        clock.now = 100_000
        sync.foregroundPull()
        assertEquals(1, source.asked.size)
    }

    @Test
    fun aLedgerTheServerNoLongerKnowsClearsTheChoiceSoTheNextPullLooksAgain() = runBlocking {
        val (_, sync) = signedInAndKept()
        source.respond = { throw httpError(404) }
        assertEquals(PullResult.NotFound, sync.refreshEverything())
        assertNull(choice.id)
        source.respond = { page(changes(accounts = listOf(account(1))), cursor = "c2") }
        sync.refreshEverything()
        assertEquals(2, lookup.calls)
        assertEquals("ledger-a", choice.id)
    }

    @Test
    fun noLedgersOrNoConnectionForTheLookupChangesNothing() = runBlocking {
        val (_, sync) = build(FakeTokenProtector(stored = token))
        lookup.result = { null }
        assertEquals(PullResult.Failed, sync.refreshEverything())
        lookup.result = { throw IOException("offline") }
        assertEquals(PullResult.Offline, sync.refreshEverything())
        assertTrue(source.asked.isEmpty())
    }

    @Test
    fun withNoReadableTokenNothingIsAskedOfTheServer() = runBlocking {
        val noLock = FakeTokenProtector(protection = app.ledgerline.android.session.Protection.NoScreenLock, stored = token)
        val (_, sync) = build(noLock)
        assertEquals(PullResult.Failed, sync.refreshEverything())
        assertEquals(0, lookup.calls)
        assertTrue(source.asked.isEmpty())
    }
}
