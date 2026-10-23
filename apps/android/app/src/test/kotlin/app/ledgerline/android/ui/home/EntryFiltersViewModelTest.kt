package app.ledgerline.android.ui.home

import app.ledgerline.android.mirror.EntryFilters
import app.ledgerline.android.mirror.MirrorDatabase
import app.ledgerline.android.mirror.MirrorStore
import app.ledgerline.android.mirror.Stamp
import app.ledgerline.android.mirror.SyncEngine
import app.ledgerline.android.mirror.SyncLock
import app.ledgerline.android.mirror.account
import app.ledgerline.android.mirror.changes
import app.ledgerline.android.mirror.entry
import app.ledgerline.android.mirror.id
import app.ledgerline.android.mirror.page
import app.ledgerline.android.mirror.tag
import app.ledgerline.android.mirror.toRows
import app.ledgerline.android.outbox.FakeServer
import app.ledgerline.android.outbox.PushEngine
import app.ledgerline.android.outbox.memoryDatabase
import app.ledgerline.android.outbox.outboxFor
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
import app.ledgerline.android.ui.editor.Choice
import app.ledgerline.api.SessionToken
import app.ledgerline.api.SyncCategory
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** What Transactions is narrowed to lives in the view model, so a tab switch keeps it and a sign-out clears it. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class EntryFiltersViewModelTest {
    private lateinit var database: MirrorDatabase
    private lateinit var session: SessionManager
    private lateinit var viewModel: SignedInViewModel
    private val ledger = "ledger-a"

    private fun category(n: Int, name: String, kind: String = "expense", archived: Boolean = false) =
        SyncCategory(id(n), Stamp, Stamp, null, 1, null, name, kind, null, null, n.toLong(), if (archived) Stamp else null)

    @Before
    fun open() = runBlocking {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        database = memoryDatabase()
        val outbox = outboxFor(database)
        session = SessionManager(FakeTokenProtector(), FakeClock())
        session.signedIn(SessionToken("tok"))
        session.skipProtect()
        val lock = SyncLock()
        val engine = SyncEngine(HoldableSource { page() }, MirrorStore(database), lock)
        val choice = FakeLedgerChoice(ledger)
        val runner = SyncRunner(engine, PushEngine(FakeServer(), outbox, lock), FakeLookup(), choice, session)
        val sync = SyncCoordinator(session, runner, engine, FakeScheduler(), choice, FakeClock())
        viewModel = SignedInViewModel(
            FakeServerAddressStore(null),
            ClientsProvider(session),
            session,
            sync,
            LedgerView(database.reads(), database.dao(), database.outbox()),
            outbox,
            database.reads(),
        )
        // 150 entries: "Bakery 1" to "Bakery 149" and one "Cinema", newest first by date.
        val entries = (1..149).map { entry(10 + it, payee = "Bakery $it").copy(date = "2026-09-%02d".format(1 + it % 28)) } +
            entry(500, payee = "Cinema").copy(date = "2026-10-20", status = "pending")
        MirrorStore(database).replaceAll(
            ledger,
            changes(
                accounts = listOf(account(1, name = "Checking"), account(2, name = "Old").copy(archivedAt = Stamp)),
                tags = listOf(tag(20, name = "work"), tag(21, name = "Archived tag").copy(archivedAt = Stamp)),
                transactions = entries,
            ).copy(
                categories = listOf(category(31, "Salary", "income"), category(30, "Food"), category(32, "Old food", archived = true)),
            ).toRows(ledger),
            "c",
            Stamp,
        )
    }

    @After
    fun close() {
        // Its background reads must stop before the database closes, or they fail inside whichever test runs next.
        viewModel.viewModelScope.cancel()
        database.close()
        Dispatchers.resetMain()
    }

    private suspend fun shown(): List<String?> =
        withTimeout(5_000) { (viewModel.entries.first { it is Mirrored.Ready } as Mirrored.Ready).items.map { it.line.payee } }

    @Test
    fun itStartsUnfilteredAndAFilterNarrowsTheListUntilCleared() = runBlocking {
        assertEquals(EntryFilters(), viewModel.filters.value)
        assertEquals(100, shown().size)
        viewModel.setFilters(EntryFilters(text = "cinema"))
        assertEquals(listOf("Cinema"), withTimeout(5_000) { (viewModel.entries.first { it is Mirrored.Ready && it.items.size == 1 } as Mirrored.Ready).items.map { it.line.payee } })
        viewModel.clearFilters()
        assertEquals(EntryFilters(), viewModel.filters.value)
        assertEquals(100, withTimeout(5_000) { (viewModel.entries.first { it is Mirrored.Ready && it.items.size == 100 } as Mirrored.Ready).items.size })
    }

    @Test
    fun changingTheFiltersStartsTheListAgainFromItsFirstPage() = runBlocking {
        assertEquals(100, shown().size)
        viewModel.showMoreEntries()
        assertEquals(150, withTimeout(5_000) { (viewModel.entries.first { it is Mirrored.Ready && it.items.size == 150 } as Mirrored.Ready).items.size })
        viewModel.setFilters(EntryFilters(status = "pending"))
        viewModel.clearFilters()
        assertEquals(100, withTimeout(5_000) { (viewModel.entries.first { it is Mirrored.Ready && it.items.size == 100 } as Mirrored.Ready).items.size })
        assertTrue(viewModel.canShowMore.first { it })
    }

    @Test
    fun anEndDateBeforeTheStartShowsNoEntriesUntilItIsCorrected() = runBlocking {
        viewModel.setFilters(EntryFilters(from = "2026-10-31", to = "2026-10-01"))
        assertEquals(emptyList<String?>(), withTimeout(5_000) { (viewModel.entries.first { it is Mirrored.Ready && it.items.isEmpty() } as Mirrored.Ready).items.map { it.line.payee } })
        viewModel.setFilters(EntryFilters(from = "2026-10-01", to = "2026-10-31"))
        assertEquals(listOf("Cinema"), withTimeout(5_000) { (viewModel.entries.first { it is Mirrored.Ready && it.items.size == 1 } as Mirrored.Ready).items.map { it.line.payee } })
    }

    @Test
    fun theFiltersOfferEveryAccountCategoryAndTagWithArchivedOnesMarked() = runBlocking {
        val options = withTimeout(5_000) { viewModel.filterOptions.first { it.accounts.isNotEmpty() && it.categories.isNotEmpty() && it.tags.isNotEmpty() } }
        assertEquals(listOf(Choice(id(1), "Checking", "USD"), Choice(id(2), "Old", "USD", archived = true)), options.accounts)
        // Expense categories first, then income, an archived one marked rather than hidden.
        assertEquals(listOf("Food", "Old food", "Salary"), options.categories.map { it.label })
        assertEquals(listOf(false, true, false), options.categories.map { it.archived })
        assertEquals(listOf(Choice(id(21), "Archived tag", archived = true), Choice(id(20), "work")), options.tags)
    }

    @Test
    fun signingOutClearsTheFilters() = runBlocking {
        viewModel.setFilters(EntryFilters(text = "x", status = "pending"))
        viewModel.signOut()
        withTimeout(5_000) { session.state.first { it == SessionState.SignedOut } }
        assertFalse(viewModel.filters.value.applied)
    }
}
