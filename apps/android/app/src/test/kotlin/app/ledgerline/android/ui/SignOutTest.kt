package app.ledgerline.android.ui

import app.ledgerline.android.mirror.MirrorDatabase
import app.ledgerline.android.mirror.MirrorStore
import app.ledgerline.android.mirror.SyncEngine
import app.ledgerline.android.mirror.SyncLock
import app.ledgerline.android.mirror.account
import app.ledgerline.android.mirror.changes
import app.ledgerline.android.mirror.page
import app.ledgerline.android.outbox.FakeServer
import app.ledgerline.android.outbox.OutboxStore
import app.ledgerline.android.outbox.PushEngine
import app.ledgerline.android.outbox.json
import app.ledgerline.android.outbox.memoryDatabase
import app.ledgerline.android.outbox.outboxFor
import app.ledgerline.android.outbox.rejected
import app.ledgerline.android.overlay.LedgerView
import app.ledgerline.android.session.ClientsProvider
import app.ledgerline.android.session.SessionManager
import app.ledgerline.android.session.SessionState
import app.ledgerline.android.sync.FakeLedgerChoice
import app.ledgerline.android.sync.FakeLookup
import app.ledgerline.android.sync.FakeScheduler
import app.ledgerline.android.sync.HoldableSource
import app.ledgerline.android.sync.SyncCoordinator
import app.ledgerline.android.sync.SyncRunner
import app.ledgerline.android.testing.FakeClock
import app.ledgerline.android.testing.FakeServerAddressStore
import app.ledgerline.android.testing.FakeTokenProtector
import app.ledgerline.android.ui.home.SignedInViewModel
import app.ledgerline.api.SessionToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Signing out never deletes changes the server does not have without the owner saying so. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SignOutTest {
    private lateinit var database: MirrorDatabase
    private lateinit var outbox: OutboxStore
    private lateinit var session: SessionManager
    private lateinit var viewModel: SignedInViewModel
    private val server = FakeServer()

    @Before
    fun open() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        database = memoryDatabase()
        outbox = outboxFor(database)
        session = SessionManager(FakeTokenProtector(), FakeClock())
        session.signedIn(SessionToken("tok"))
        session.skipProtect()
        val lock = SyncLock()
        val engine = SyncEngine(HoldableSource { page(changes(accounts = listOf(account(1)))) }, MirrorStore(database), lock)
        val choice = FakeLedgerChoice("ledger-a")
        val runner = SyncRunner(engine, PushEngine(server, outbox, lock), FakeLookup(), choice, session)
        val sync = SyncCoordinator(session, runner, engine, FakeScheduler(), choice, FakeClock())
        viewModel = SignedInViewModel(
            FakeServerAddressStore(null),
            ClientsProvider(session),
            session,
            sync,
            LedgerView(database.reads(), database.dao(), database.outbox()),
            outbox,
            database.reads(),
            app.ledgerline.android.testing.FakePhoneSettings(),
            app.ledgerline.android.testing.FakeFilterStore(),
            app.ledgerline.android.outbox.FakeWallClock(),
        )
    }

    @After
    fun close() {
        database.close()
        Dispatchers.resetMain()
    }

    private suspend fun signedOut() = withTimeout(5_000) { session.state.first { it == SessionState.SignedOut } }

    private suspend fun question() = withTimeout(5_000) { viewModel.confirmSignOut.first { it != null } }

    @Test
    fun withNothingWaitingSignOutGoesStraightThrough() = runBlocking {
        viewModel.signOut()
        signedOut()
        assertNull(viewModel.confirmSignOut.value)
    }

    @Test
    fun withChangesTheServerDoesNotHaveItAsksFirstAndCancelKeepsEverything() = runBlocking {
        outbox.createEntry("ledger-a", json("payee" to "Unsent"))
        val second = outbox.createEntry("ledger-a", json("payee" to "Rejected"))
        server.answer = { id -> if (id == second) rejected(second) else null }
        server.fail = java.io.IOException("offline")
        viewModel.signOut()
        assertEquals(2, question())
        assertEquals(SessionState.Unlocked, session.state.value)
        viewModel.cancelSignOut()
        assertNull(viewModel.confirmSignOut.value)
        assertEquals(2, outbox.notOnServerCount())
    }

    @Test
    fun deletingThemIsTheOwnersExplicitChoice() = runBlocking {
        outbox.createEntry("ledger-a", json("payee" to "Unsent"))
        viewModel.signOut()
        question()
        viewModel.signOutDeletingUnsent()
        signedOut()
        assertEquals(0, outbox.notOnServerCount())
    }

    @Test
    fun sendNowSendsAndKeepsTheOwnerSignedIn() = runBlocking {
        outbox.createEntry("ledger-a", json("payee" to "Unsent"))
        viewModel.signOut()
        question()
        viewModel.sendBeforeSigningOut()
        withTimeout(5_000) { while (outbox.notOnServerCount() > 0) kotlinx.coroutines.delay(10) }
        assertEquals(1, server.applied.size)
        assertEquals(SessionState.Unlocked, session.state.value)
    }
}
