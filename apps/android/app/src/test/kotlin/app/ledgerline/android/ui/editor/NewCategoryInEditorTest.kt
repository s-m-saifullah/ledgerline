package app.ledgerline.android.ui.editor

import app.ledgerline.android.mirror.MirrorStore
import app.ledgerline.android.mirror.Stamp
import app.ledgerline.android.mirror.SyncEngine
import app.ledgerline.android.mirror.SyncLock
import app.ledgerline.android.mirror.account
import app.ledgerline.android.mirror.changes
import app.ledgerline.android.mirror.entry
import app.ledgerline.android.mirror.id
import app.ledgerline.android.mirror.page
import app.ledgerline.android.mirror.syncCategory
import app.ledgerline.android.mirror.toRows
import app.ledgerline.android.online.CategoryWrites
import app.ledgerline.android.outbox.FakeServer
import app.ledgerline.android.outbox.FakeWallClock
import app.ledgerline.android.outbox.PushEngine
import app.ledgerline.android.outbox.outboxFor
import app.ledgerline.android.overlay.LedgerView
import app.ledgerline.android.sync.FakeLedgerChoice
import app.ledgerline.android.sync.FakeLookup
import app.ledgerline.android.sync.FakeScheduler
import app.ledgerline.android.sync.HoldableSource
import app.ledgerline.android.sync.SyncCoordinator
import app.ledgerline.android.sync.SyncRunner
import app.ledgerline.android.testing.FakeClock
import app.ledgerline.android.testing.OnlineHarness
import app.ledgerline.android.ui.categories.CategoryError
import app.ledgerline.api.ApiJson
import app.ledgerline.api.Category
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Instant

private const val Ledger = "ledger-a"
private val KeyPattern = Regex("^[A-Za-z0-9._:-]{8,128}$")

/** "New category" under the Category field: what is sent, what the picker and the entry get, and what stays on screen. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NewCategoryInEditorTest {
    private val harness = OnlineHarness()
    private val memory = FakeFormMemory()
    private var sessions = 0

    private fun created(n: Int, name: String, kind: String = "expense") =
        Category(id(n), Ledger, name, kind, null, null, null, 9, null, 1, Stamp, Stamp)

    private fun answer(value: Category) = harness.json(200, ApiJson.encodeToString(Category.serializer(), value))

    private fun problem(status: Int, detail: String) =
        harness.json(status, """{"type":"about:blank","title":"x","status":$status,"detail":"$detail","errors":[]}""")

    @Before
    fun open() {
        harness.open()
        runBlocking {
            MirrorStore(harness.database).replaceAll(
                Ledger,
                changes(
                    accounts = listOf(account(1, name = "Checking")),
                    transactions = listOf(entry(11, amount = -3_000, payee = "Split").copy(isSplit = true)),
                    categories = listOf(syncCategory(20, "Food"), syncCategory(22, "Salary", kind = "income")),
                ).toRows(Ledger),
                "c", Stamp,
            )
        }
    }

    @After
    fun close() = harness.close()

    private fun editor(writes: CategoryWrites = CategoryWrites(harness.writer(), MirrorStore(harness.database))): EditorViewModel {
        val database = harness.database
        val outbox = outboxFor(database, FakeWallClock(Instant.parse("2026-10-22T15:00:00Z")))
        val lock = SyncLock()
        val engine = SyncEngine(HoldableSource { page() }, MirrorStore(database), lock)
        val choice = FakeLedgerChoice(Ledger)
        val sync = SyncCoordinator(harness.session, SyncRunner(engine, PushEngine(FakeServer(), outbox, lock), FakeLookup(), choice, harness.session), engine, FakeScheduler(), choice, FakeClock())
        return EditorViewModel(
            database.reads(), database.dao(), LedgerView(database.reads(), database.dao(), database.outbox()), outbox, sync, memory,
            FakeWallClock(Instant.parse("2026-10-22T15:00:00Z")), writes,
        )
    }

    private suspend fun EditorViewModel.opened(target: EditorTarget, session: String = "s${++sessions}"): EditorState {
        open(target, session)
        return withTimeout(5_000) { state.first { it != null && it.session == session }!! }
    }

    private fun EditorViewModel.type(name: String) {
        if (newCategory.value == null) toggleNewCategory()
        setNewCategoryName(name)
    }

    private fun EditorViewModel.finished() = harness.until { newCategory.value?.creating != true }

    @Test
    fun theBoxIsClosedUntilOpenedAndClosesAgain() = runBlocking {
        val editor = editor()
        editor.opened(EditorTarget.New())
        assertNull(editor.newCategory.value)
        editor.toggleNewCategory()
        assertEquals(NewCategory(), editor.newCategory.value)
        editor.toggleNewCategory()
        assertNull(editor.newCategory.value)
    }

    @Test
    fun aTransferHasNoCategoryAndAnEntryThatCannotBeEditedHasNoBox() = runBlocking {
        val editor = editor()
        editor.opened(EditorTarget.New(EntryMode.Transfer))
        editor.toggleNewCategory()
        assertNull(editor.newCategory.value)
        editor.opened(EditorTarget.Entry(id(11)))
        editor.toggleNewCategory()
        assertNull(editor.newCategory.value)
    }

    @Test
    fun aNameMustHaveSomethingInItAndFitTheLimitBeforeAnythingIsSent() = runBlocking {
        val editor = editor()
        editor.opened(EditorTarget.New())
        for (name in listOf("", "   ", "x".repeat(101))) {
            editor.type(name)
            editor.createCategory()
        }
        // A request would arrive within a moment; nothing does.
        assertTrue(harness.quiet())
        assertTrue(harness.recorded.isEmpty())
        assertFalse(NewCategory("x".repeat(101)).valid)
        assertTrue(NewCategory(" Pets ").valid)
        assertTrue(NewCategory("x".repeat(100)).valid)
    }

    @Test
    fun creatingSendsATopLevelCategoryOfTheEntrysKindAndChoosesItForTheEntry() = runBlocking {
        harness.route("/api/v1/ledgers/ledger-a/categories") { answer(created(30, "Pets")) }
        val editor = editor()
        editor.opened(EditorTarget.New())
        editor.type("  Pets ")
        editor.createCategory()
        editor.finished()
        val sent = harness.recorded.single()
        assertEquals("POST", sent.method)
        assertEquals("/api/v1/ledgers/ledger-a/categories", sent.target)
        assertEquals("""{"name":"Pets","kind":"expense"}""", sent.body)
        assertTrue(KeyPattern.matches(sent.idempotencyKey.orEmpty()))
        assertEquals("Bearer tok", harness.tokens.single())
        assertNull(editor.newCategory.value)
        val state = editor.state.value!!
        assertEquals(id(30), state.form.categoryId)
        assertTrue(state.categories.any { it.id == id(30) && it.label == "Pets" })
        // The category is in the mirror as well, so the Categories screen and every picker have it.
        assertTrue(harness.database.dao().allCategories(Ledger).any { it.id == id(30) })
    }

    @Test
    fun anIncomeEntryMakesAnIncomeCategory() = runBlocking {
        harness.route("/api/v1/ledgers/ledger-a/categories") { answer(created(31, "Tips", kind = "income")) }
        val editor = editor()
        editor.opened(EditorTarget.New(EntryMode.Income))
        editor.type("Tips")
        editor.createCategory()
        editor.finished()
        assertEquals("""{"name":"Tips","kind":"income"}""", harness.recorded.single().body)
        assertEquals(id(31), editor.state.value!!.form.categoryId)
    }

    @Test
    fun theNewCategoryIsUsedWhenTheEntryIsSaved() = runBlocking {
        harness.route("/api/v1/ledgers/ledger-a/categories") { answer(created(30, "Pets")) }
        val editor = editor()
        editor.opened(EditorTarget.New())
        editor.update { it.copy(amount = "4.50") }
        editor.type("Pets")
        editor.createCategory()
        editor.finished()
        editor.save()
        withTimeout(5_000) { editor.state.first { it?.done == true } }
        // Saving remembers the category the entry was saved with, so the next new expense starts on it.
        assertEquals(id(30), memory.categories["expense"])
        assertEquals(id(30), editor.state.value!!.form.categoryId)
    }

    @Test
    fun noConnectionKeepsTheBoxAndTheNameAndSaysSo() = runBlocking {
        val editor = editor(CategoryWrites(harness.writer(harness.closedOrigin()), MirrorStore(harness.database)))
        editor.opened(EditorTarget.New())
        editor.type("Pets")
        editor.createCategory()
        editor.finished()
        val box = editor.newCategory.value!!
        assertEquals("Pets", box.name)
        assertEquals(CategoryError.Offline, box.error)
        assertFalse(box.creating)
        assertNull(editor.state.value!!.form.categoryId?.takeIf { it == id(30) })
    }

    @Test
    fun theServersSentenceIsShownAndTheNameStays() = runBlocking {
        harness.route("/api/v1/ledgers/ledger-a/categories") { problem(409, "A sibling category already has this name, including archived categories.") }
        val editor = editor()
        editor.opened(EditorTarget.New())
        editor.type("Food")
        editor.createCategory()
        editor.finished()
        assertEquals(CategoryError.Rejected("A sibling category already has this name, including archived categories."), editor.newCategory.value!!.error)
        assertEquals("Food", editor.newCategory.value!!.name)
        editor.setNewCategoryName("Food and drink")
        assertNull(editor.newCategory.value!!.error)
    }

    @Test
    fun theSameNameKeepsItsKeyAfterAFailureAndAChangedNameGetsAnother() = runBlocking {
        harness.route("/api/v1/ledgers/ledger-a/categories") { harness.json(500, "{}") }
        val editor = editor()
        editor.opened(EditorTarget.New())
        editor.type("Pets")
        editor.createCategory()
        editor.finished()
        editor.createCategory()
        harness.until { harness.recorded.size == 2 }
        editor.finished()
        editor.setNewCategoryName("Pets and vets")
        editor.createCategory()
        harness.until { harness.recorded.size == 3 }
        editor.finished()
        val keys = harness.recorded.map { it.idempotencyKey }
        assertEquals(keys[0], keys[1])
        assertNotEquals(keys[1], keys[2])
        assertEquals(CategoryError.Failed, editor.newCategory.value!!.error)
    }

    @Test
    fun aKeyIsNeverReusedForALaterCategoryOfTheSameName() = runBlocking {
        harness.route("/api/v1/ledgers/ledger-a/categories") { answer(created(30, "Pets")) }
        val editor = editor()
        editor.opened(EditorTarget.New())
        repeat(2) {
            editor.type("Pets")
            editor.createCategory()
            editor.finished()
        }
        val keys = harness.recorded.map { it.idempotencyKey }
        assertEquals(2, keys.size)
        assertNotEquals(keys[0], keys[1])
    }

    @Test
    fun aSecondTapWhileCreatingSendsNothingMore() = runBlocking {
        harness.delayMillis = 400
        harness.route("/api/v1/ledgers/ledger-a/categories") { answer(created(30, "Pets")) }
        val editor = editor()
        editor.opened(EditorTarget.New())
        editor.type("Pets")
        editor.createCategory()
        assertTrue(editor.newCategory.value!!.creating)
        editor.createCategory()
        editor.setNewCategoryName("Other")
        editor.toggleNewCategory()
        editor.finished()
        assertEquals(1, harness.recorded.size)
        assertEquals(id(30), editor.state.value!!.form.categoryId)
    }

    @Test
    fun aReplyAfterTheEditorWasReopenedDoesNotTouchTheNewOpening() = runBlocking {
        harness.delayMillis = 400
        harness.route("/api/v1/ledgers/ledger-a/categories") { answer(created(30, "Pets")) }
        val editor = editor()
        editor.opened(EditorTarget.New())
        editor.type("Pets")
        editor.createCategory()
        editor.opened(EditorTarget.New())
        harness.until { runBlocking { harness.database.dao().allCategories(Ledger).any { it.id == id(30) } } }
        // The category was made and is in the mirror, but the second opening has not been given it.
        assertNull(editor.newCategory.value)
        assertNotEquals(id(30), editor.state.value!!.form.categoryId)
        assertNotNull(editor.state.value)
    }
}
