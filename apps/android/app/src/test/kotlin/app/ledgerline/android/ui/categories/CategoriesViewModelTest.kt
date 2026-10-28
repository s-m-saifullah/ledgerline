package app.ledgerline.android.ui.categories

import app.ledgerline.android.mirror.MirrorStore
import app.ledgerline.android.mirror.PullSource
import app.ledgerline.android.mirror.Stamp
import app.ledgerline.android.mirror.SyncEngine
import app.ledgerline.android.mirror.SyncLock
import app.ledgerline.android.mirror.changes
import app.ledgerline.android.mirror.entry
import app.ledgerline.android.mirror.id
import app.ledgerline.android.mirror.page
import app.ledgerline.android.mirror.syncCategory
import app.ledgerline.android.mirror.toRows
import app.ledgerline.android.online.CategoryWrites
import app.ledgerline.android.outbox.PushEngine
import app.ledgerline.android.outbox.FakeServer
import app.ledgerline.android.outbox.outboxFor
import app.ledgerline.android.session.SessionState
import app.ledgerline.android.sync.FakeLedgerChoice
import app.ledgerline.android.sync.FakeLookup
import app.ledgerline.android.sync.FakeScheduler
import app.ledgerline.android.sync.SyncCoordinator
import app.ledgerline.android.sync.SyncRunner
import app.ledgerline.android.testing.FakeClock
import app.ledgerline.android.testing.OnlineHarness
import app.ledgerline.api.ApiJson
import app.ledgerline.api.Category
import app.ledgerline.api.SyncResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
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
import java.util.concurrent.atomic.AtomicInteger

private const val Ledger = "ledger-a"
private val KeyPattern = Regex("^[A-Za-z0-9._:-]{8,128}$")

/** Categories against a mock server and the real mirror: what is listed, what is sent, and what stays on screen. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class CategoriesViewModelTest {
    private val harness = OnlineHarness()
    private val pulls = AtomicInteger()
    private lateinit var viewModel: CategoriesViewModel
    private lateinit var watching: Job

    private fun category(n: Int, name: String, kind: String = "expense", parentN: Int? = null, version: Int = 1, archived: Boolean = false) =
        Category(id(n), Ledger, name, kind, parentN?.let(::id), null, null, n.toLong(), if (archived) Stamp else null, version, Stamp, Stamp)

    private fun answer(value: Category) = harness.json(200, ApiJson.encodeToString(Category.serializer(), value))

    private fun problem(status: Int, detail: String) =
        harness.json(status, """{"type":"about:blank","title":"x","status":$status,"detail":"$detail","errors":[]}""")

    @Before
    fun open() {
        harness.open()
        val database = harness.database
        runBlocking {
            MirrorStore(database).replaceAll(
                Ledger,
                changes(
                    categories = listOf(
                        syncCategory(1, "Food"), syncCategory(2, "Groceries", parentN = 1, version = 3), syncCategory(3, "Transport"),
                        syncCategory(4, "Salary", kind = "income"),
                    ),
                ).toRows(Ledger),
                "c0", Stamp,
            )
        }
        val outbox = outboxFor(database)
        val lock = SyncLock()
        val source = object : PullSource {
            override suspend fun pull(ledgerId: String, cursor: String?, limit: Int): SyncResponse {
                pulls.incrementAndGet()
                return page()
            }
        }
        val engine = SyncEngine(source, MirrorStore(database), lock)
        val choice = FakeLedgerChoice(Ledger)
        val runner = SyncRunner(engine, PushEngine(FakeServer(), outbox, lock), FakeLookup(), choice, harness.session)
        val sync = SyncCoordinator(harness.session, runner, engine, FakeScheduler(), choice, FakeClock())
        viewModel = CategoriesViewModel(database.reads(), CategoryWrites(harness.writer(), MirrorStore(database)), sync)
        // The screen collects these while it shows; here a collector stands in for it.
        watching = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined).launch {
            launch { viewModel.groups.collect { } }
            launch { viewModel.items.collect { } }
        }
        harness.until { viewModel.groups.value != null }
    }

    @After
    fun close() {
        watching.cancel()
        harness.close()
    }

    private fun groupNames() = viewModel.groups.value.orEmpty().map { group -> group.root.name + group.children.joinToString(prefix = "[", postfix = "]") { it.name } }

    private fun typeAndSave(name: String, parent: String? = null) {
        viewModel.startAdd()
        viewModel.edit { it.copy(name = name, parentId = parent) }
        viewModel.save()
        harness.until { !viewModel.view.value.saving }
    }

    @Test
    fun theListFollowsTheMirrorAndTheChosenKindStatusAndSearch() {
        assertEquals(listOf("Food[Groceries]", "Transport[]"), groupNames())
        viewModel.setKind("income")
        harness.until { groupNames() == listOf("Salary[]") }
        viewModel.setKind("expense")
        viewModel.setSearch("groc")
        harness.until { groupNames() == listOf("Food[Groceries]") }
        // Nothing of this kind is archived, so the Archived chip is not shown and cannot keep the list empty.
        viewModel.setStatus(CategoryStatus.Archived)
        harness.until { groupNames() == listOf("Food[Groceries]") }
    }

    @Test
    fun theArchivedFilterWorksWhileSomethingIsArchivedAndFallsAwayWhenTheKindHasNone() {
        runBlocking {
            MirrorStore(harness.database).putCategory(
                app.ledgerline.android.mirror.CategoryRow(Ledger, id(3), 2, Stamp, Stamp, null, null, "Transport", "expense", null, null, 3, Stamp),
            )
        }
        viewModel.setStatus(CategoryStatus.Archived)
        harness.until { groupNames() == listOf("Transport[]") }
        viewModel.setKind("income")
        harness.until { groupNames() == listOf("Salary[]") }
    }

    @Test
    fun groupsOpenAndCloseOneByOneAndAllAtOnce() {
        viewModel.toggleGroup(id(1))
        assertEquals(setOf(id(1)), viewModel.view.value.expanded)
        viewModel.toggleGroup(id(1))
        assertEquals(emptySet<String>(), viewModel.view.value.expanded)
        viewModel.toggleAll(listOf(id(1), id(3)))
        assertEquals(setOf(id(1), id(3)), viewModel.view.value.expanded)
        // One still closed: Expand all opens it; all open: the next tap closes them.
        viewModel.toggleGroup(id(3))
        viewModel.toggleAll(listOf(id(1), id(3)))
        assertEquals(setOf(id(1), id(3)), viewModel.view.value.expanded)
        viewModel.toggleAll(listOf(id(1), id(3)))
        assertEquals(emptySet<String>(), viewModel.view.value.expanded)
    }

    @Test
    fun theActionsSheetOpensForARowAndEveryActionFromItClosesIt() {
        val food = viewModel.items.value!!.first { it.id == id(1) }
        viewModel.openMenu(food)
        assertEquals(food, viewModel.view.value.menu)
        viewModel.closeMenu()
        assertNull(viewModel.view.value.menu)
        viewModel.openMenu(food); viewModel.startEdit(food)
        assertNull(viewModel.view.value.menu)
        viewModel.openMenu(food); viewModel.askArchive(food)
        assertNull(viewModel.view.value.menu)
        viewModel.dismissAsk()
        viewModel.openMenu(food); viewModel.startAddUnder(food)
        assertNull(viewModel.view.value.menu)
        viewModel.closeForm()
        viewModel.openMenu(food); viewModel.askDelete(food)
        assertNull(viewModel.view.value.menu)
        viewModel.openMenu(food); viewModel.startAdd()
        assertNull(viewModel.view.value.menu)
    }

    @Test
    fun addingUnderAGroupOpensTheFormOnItsKindWithTheParentChosen() {
        val salaryRoot = viewModel.items.value!!.first { it.id == id(4) }
        viewModel.startAddUnder(salaryRoot)
        assertEquals("income", viewModel.view.value.form?.kind)
        assertEquals(id(4), viewModel.view.value.form?.parentId)
        assertNull(viewModel.view.value.form?.editing)
    }

    @Test
    fun aNewSubcategoryOpensItsGroupButAnEditOrAMainCategoryDoesNot() {
        harness.route("/api/v1/ledgers/ledger-a/categories") { answer(category(11, "Dining out", parentN = 3)) }
        typeAndSave("Dining out", parent = id(3))
        assertEquals(setOf(id(3)), viewModel.view.value.expanded)
        harness.route("/api/v1/ledgers/ledger-a/categories") { answer(category(12, "Pets")) }
        typeAndSave("Pets")
        assertEquals(setOf(id(3)), viewModel.view.value.expanded)
    }

    @Test
    fun anAddStartsOnTheChosenKindAndSavingABlankNameSendsNothing() {
        viewModel.setKind("income")
        viewModel.startAdd()
        assertEquals("income", viewModel.view.value.form?.kind)
        viewModel.save()
        assertTrue(harness.recorded.isEmpty())
        assertFalse(viewModel.view.value.saving)
        assertTrue(viewModel.view.value.form != null)
    }

    @Test
    fun addingACategorySendsItWithAKeyAndShowsItAtOnce() {
        harness.route("/api/v1/ledgers/ledger-a/categories") { answer(category(10, "Pets")) }
        typeAndSave("  Pets ")
        val sent = harness.recorded.single()
        assertEquals("POST", sent.method)
        assertEquals("""{"name":"Pets","kind":"expense"}""", sent.body)
        assertTrue(KeyPattern.matches(sent.idempotencyKey.orEmpty()))
        assertEquals("Bearer tok", harness.tokens.single())
        assertEquals(CategoryNotice.Added, viewModel.view.value.notice)
        assertNull(viewModel.view.value.form)
        // The returned row is in the mirror, so the list shows it without waiting for a pull.
        harness.until { "Pets[]" in groupNames() }
        assertEquals(0, pulls.get())
    }

    @Test
    fun aSubcategoryIsSentUnderItsMainCategory() {
        harness.route("/api/v1/ledgers/ledger-a/categories") { answer(category(11, "Dining out", parentN = 1)) }
        typeAndSave("Dining out", parent = id(1))
        assertEquals("""{"name":"Dining out","kind":"expense","parentId":"${id(1)}"}""", harness.recorded.single().body)
        harness.until { "Food[Dining out, Groceries]" in groupNames() || "Food[Groceries, Dining out]" in groupNames() }
    }

    @Test
    fun theSameChangeKeepsItsKeyAfterAFailureAndAChangedOneGetsAnother() {
        harness.route("/api/v1/ledgers/ledger-a/categories") { harness.json(500, "{}") }
        typeAndSave("Pets")
        typeAndSaveAgain()
        viewModel.edit { it.copy(name = "Pets and vets") }
        viewModel.save()
        harness.until { harness.recorded.size == 3 && !viewModel.view.value.saving }
        val keys = harness.recorded.map { it.idempotencyKey }
        assertEquals(keys[0], keys[1])
        assertNotEquals(keys[1], keys[2])
        assertEquals(CategoryError.Failed, viewModel.view.value.error)
        assertEquals("Pets and vets", viewModel.view.value.form?.name)
    }

    @Test
    fun aKeyIsNeverReusedForALaterAddOfTheSameName() {
        harness.route("/api/v1/ledgers/ledger-a/categories") { answer(category(10, "Pets")) }
        typeAndSave("Pets")
        typeAndSave("Pets")
        val keys = harness.recorded.map { it.idempotencyKey }
        assertEquals(2, keys.size)
        // The server replays a request with a key it has seen; a second, later add must be a new request.
        assertNotEquals(keys[0], keys[1])
    }

    private fun typeAndSaveAgain() {
        viewModel.save()
        harness.until { harness.recorded.size == 2 && !viewModel.view.value.saving }
    }

    @Test
    fun noConnectionKeepsTheFormAndWhatWasTyped() {
        // A writer pointed at an address nothing answers at, over the same mirror.
        val database = harness.database
        val offline = CategoriesViewModel(database.reads(), CategoryWrites(harness.writer(harness.closedOrigin()), MirrorStore(database)), unusedSync())
        val job = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined).launch { offline.items.collect { } }
        harness.until { offline.items.value != null }
        offline.startAdd()
        offline.edit { it.copy(name = "Pets") }
        offline.save()
        harness.until { !offline.view.value.saving }
        assertEquals(CategoryError.Offline, offline.view.value.error)
        assertEquals("Pets", offline.view.value.form?.name)
        assertNull(offline.view.value.notice)
        job.cancel()
    }

    private fun unusedSync(): SyncCoordinator {
        val lock = SyncLock()
        val engine = SyncEngine(object : PullSource {
            override suspend fun pull(ledgerId: String, cursor: String?, limit: Int) = page()
        }, MirrorStore(harness.database), lock)
        val choice = FakeLedgerChoice(Ledger)
        return SyncCoordinator(
            harness.session, SyncRunner(engine, PushEngine(FakeServer(), outboxFor(harness.database), lock), FakeLookup(), choice, harness.session),
            engine, FakeScheduler(), choice, FakeClock(),
        )
    }

    @Test
    fun theServersSentenceIsShownAndAStaleVersionBringsThePhoneUpToDate() {
        harness.route("/api/v1/ledgers/ledger-a/categories") { problem(409, "A sibling category already has this name, including archived categories.") }
        typeAndSave("Food")
        assertEquals(CategoryError.Rejected("A sibling category already has this name, including archived categories."), viewModel.view.value.error)
        harness.until { pulls.get() >= 1 }
    }

    @Test
    fun aBadRequestWithoutASentenceIsShownWithoutOneAndDoesNotPull() {
        harness.route("/api/v1/ledgers/ledger-a/categories") { harness.json(422, "<html>") }
        typeAndSave("Pets")
        assertEquals(CategoryError.Rejected(null), viewModel.view.value.error)
        assertEquals(0, pulls.get())
    }

    @Test
    fun anAccountThatMayNotWriteSeesThatAndARefusedTokenSignsOut() {
        harness.route("/api/v1/ledgers/ledger-a/categories") { problem(403, "No.") }
        typeAndSave("Pets")
        assertEquals(CategoryError.Forbidden, viewModel.view.value.error)
        harness.route("/api/v1/ledgers/ledger-a/categories") { problem(401, "Sign in.") }
        viewModel.save()
        harness.until { !viewModel.view.value.saving && harness.session.state.value != SessionState.Unlocked }
        assertEquals(CategoryError.Failed, viewModel.view.value.error)
    }

    @Test
    fun anEditSendsOnlyWhatChangedWithTheStoredVersionAndAnUnchangedFormSendsNothing() {
        harness.route("/api/v1/ledgers/ledger-a/categories/${id(2)}") { answer(category(2, "Supermarket", parentN = 1, version = 4)) }
        val groceries = viewModel.items.value!!.first { it.id == id(2) }
        viewModel.startEdit(groceries)
        viewModel.save()
        assertTrue(harness.recorded.isEmpty())
        assertNull(viewModel.view.value.form)
        viewModel.startEdit(groceries)
        viewModel.edit { it.copy(name = "Supermarket") }
        viewModel.save()
        harness.until { !viewModel.view.value.saving }
        val sent = harness.recorded.single()
        assertEquals("PATCH", sent.method)
        assertEquals("""{"expectedVersion":3,"name":"Supermarket"}""", sent.body)
        assertEquals(CategoryNotice.Updated, viewModel.view.value.notice)
        // An edit does not open the group the subcategory sits in.
        assertEquals(emptySet<String>(), viewModel.view.value.expanded)
        harness.until { "Food[Supermarket]" in groupNames() }
    }

    @Test
    fun makingASubcategoryAMainOneSendsAnExplicitNull() {
        harness.route("/api/v1/ledgers/ledger-a/categories/${id(2)}") { answer(category(2, "Groceries", version = 4)) }
        viewModel.startEdit(viewModel.items.value!!.first { it.id == id(2) })
        viewModel.edit { it.copy(parentId = null) }
        viewModel.save()
        harness.until { !viewModel.view.value.saving }
        assertEquals("""{"expectedVersion":3,"parentId":null}""", harness.recorded.single().body)
    }

    @Test
    fun archivingAsksFirstThenSendsTheStoredVersionAndMarksItArchived() {
        harness.route("/api/v1/ledgers/ledger-a/categories/${id(3)}/archive") { answer(category(3, "Transport", version = 2, archived = true)) }
        val transport = viewModel.items.value!!.first { it.id == id(3) }
        viewModel.askArchive(transport)
        assertEquals(transport, viewModel.view.value.ask?.category)
        assertTrue(harness.recorded.isEmpty())
        viewModel.dismissAsk()
        assertNull(viewModel.view.value.ask)
        viewModel.askArchive(transport)
        viewModel.confirmArchive()
        harness.until { !viewModel.view.value.saving && harness.recorded.isNotEmpty() }
        val sent = harness.recorded.single()
        assertEquals("/api/v1/ledgers/ledger-a/categories/${id(3)}/archive", sent.target)
        assertEquals("""{"expectedVersion":1}""", sent.body)
        assertEquals(CategoryNotice.Archived, viewModel.view.value.notice)
        harness.until { viewModel.items.value!!.first { it.id == id(3) }.archivedAt != null }
    }

    @Test
    fun unarchivingSendsTheStoredVersion() {
        runBlocking {
            MirrorStore(harness.database).putCategory(
                app.ledgerline.android.mirror.CategoryRow(Ledger, id(3), 2, Stamp, Stamp, null, null, "Transport", "expense", null, null, 3, Stamp),
            )
        }
        harness.route("/api/v1/ledgers/ledger-a/categories/${id(3)}/unarchive") { answer(category(3, "Transport", version = 3)) }
        harness.until { viewModel.items.value!!.first { it.id == id(3) }.archivedAt != null }
        viewModel.unarchive(viewModel.items.value!!.first { it.id == id(3) })
        harness.until { !viewModel.view.value.saving && harness.recorded.isNotEmpty() }
        assertEquals("""{"expectedVersion":2}""", harness.recorded.single().body)
        assertEquals(CategoryNotice.Unarchived, viewModel.view.value.notice)
    }

    @Test
    fun theFormCannotBeClosedWhileSavingAndClosingForgetsTheKeys() {
        viewModel.startAdd()
        viewModel.edit { it.copy(name = "Pets") }
        viewModel.closeForm()
        assertNull(viewModel.view.value.form)
        assertNull(viewModel.view.value.error)
    }

    // ---- Delete: the phone checks what uses the category first, and recommends archiving when something does.

    private fun row(n: Int) = viewModel.items.value!!.first { it.id == id(n) }

    private fun ask(n: Int): DeleteAsk {
        viewModel.askDelete(row(n))
        harness.until { viewModel.view.value.deleteAsk != null }
        return viewModel.view.value.deleteAsk!!
    }

    private fun use(n: Int, entryN: Int = 10) = runBlocking {
        MirrorStore(harness.database).applyPage(Ledger, changes(transactions = listOf(entry(entryN).copy(categoryId = id(n)))).toRows(Ledger), "p$entryN", Stamp)
    }

    @Test
    fun aCategoryNothingUsesIsDeletedWithItsStoredVersionAndLeavesTheList() {
        harness.route("/api/v1/ledgers/ledger-a/categories/${id(3)}") { harness.json(204, "") }
        val asked = ask(3)
        assertNull(asked.block)
        assertTrue(harness.recorded.isEmpty())
        viewModel.confirmDelete()
        harness.until { !viewModel.view.value.saving && harness.recorded.isNotEmpty() }
        val sent = harness.recorded.single()
        assertEquals("DELETE", sent.method)
        assertEquals("/api/v1/ledgers/ledger-a/categories/${id(3)}", sent.target)
        assertEquals("""{"expectedVersion":1}""", sent.body)
        assertTrue(KeyPattern.matches(sent.idempotencyKey.orEmpty()))
        assertEquals(CategoryNotice.Deleted, viewModel.view.value.notice)
        assertNull(viewModel.view.value.deleteAsk)
        harness.until { viewModel.items.value!!.none { it.id == id(3) } }
        assertEquals(listOf("Food[Groceries]"), groupNames())
    }

    @Test
    fun aCategoryUsedByAnEntryIsNotDeletedAndArchivingIsRecommended() {
        use(3)
        val asked = ask(3)
        assertEquals(DeleteBlock.UsedByEntries(1), asked.block)
        assertTrue(asked.canArchiveInstead)
        viewModel.confirmDelete()
        assertTrue(harness.quiet())
        assertTrue(harness.recorded.isEmpty())
        assertNotNull(viewModel.view.value.deleteAsk)
    }

    @Test
    fun archivingInsteadMovesOnToTheArchiveQuestionAndSendsNothingYet() {
        use(3)
        ask(3)
        viewModel.archiveInstead()
        assertNull(viewModel.view.value.deleteAsk)
        assertEquals(id(3), viewModel.view.value.ask?.category?.id)
        assertTrue(harness.recorded.isEmpty())
    }

    @Test
    fun aSplitLineAndAnUnsentChangeCountAsUse() {
        runBlocking {
            MirrorStore(harness.database).applyPage(
                Ledger,
                changes(transactions = listOf(entry(10).copy(isSplit = true))).copy(
                    transactionSplits = listOf(app.ledgerline.api.SyncSplit(id(50), Stamp, Stamp, null, 1, id(10), id(3), "expense", app.ledgerline.api.Money(-100, "USD"), app.ledgerline.api.Money(-100, "USD"), null, 0)),
                ).toRows(Ledger),
                "p", Stamp,
            )
        }
        assertEquals(DeleteBlock.UsedByEntries(1), ask(3).block)
        viewModel.dismissDeleteAsk()
        runBlocking {
            harness.database.outbox().insert(
                app.ledgerline.android.outbox.OutboxRow(
                    "m1", Ledger, 1, "transaction", "create", id(77), null, Stamp, """{"categoryId":"${id(1)}"}""", false, "pending", null, null, null,
                ),
            )
        }
        // Food has a subcategory too, which is named first.
        assertEquals(DeleteBlock.HasSubcategories, ask(1).block)
    }

    @Test
    fun aCategoryWithSubcategoriesIsNotDeletedAndCannotBeArchivedInsteadEither() {
        use(1)
        val asked = ask(1)
        assertEquals(DeleteBlock.HasSubcategories, asked.block)
        assertFalse(asked.canArchiveInstead)
        viewModel.confirmDelete()
        viewModel.archiveInstead()
        assertTrue(harness.quiet())
        assertTrue(harness.recorded.isEmpty())
        // Still on the same question; no archive question was opened.
        assertEquals(DeleteBlock.HasSubcategories, viewModel.view.value.deleteAsk?.block)
        assertNull(viewModel.view.value.ask)
    }

    @Test
    fun anArchivedCategoryInUseCannotBeDeletedAndThereIsNothingToArchive() {
        runBlocking {
            MirrorStore(harness.database).putCategory(
                app.ledgerline.android.mirror.CategoryRow(Ledger, id(3), 2, Stamp, Stamp, null, null, "Transport", "expense", null, null, 3, Stamp),
            )
        }
        use(3)
        harness.until { viewModel.items.value!!.first { it.id == id(3) }.archivedAt != null }
        val asked = ask(3)
        assertEquals(DeleteBlock.UsedByEntries(1), asked.block)
        assertFalse(asked.canArchiveInstead)
    }

    @Test
    fun theServersRefusalIsShownAndAStalePhoneIsBroughtUpToDate() {
        // The phone thought nothing used the category; the server knows better (an entry made elsewhere, a recurring rule).
        harness.route("/api/v1/ledgers/ledger-a/categories/${id(3)}") { problem(409, "Delete the connected transactions first, or archive this item to keep its history.") }
        ask(3)
        viewModel.confirmDelete()
        harness.until { !viewModel.view.value.saving && viewModel.view.value.error != null }
        assertEquals(CategoryError.Rejected("Delete the connected transactions first, or archive this item to keep its history."), viewModel.view.value.error)
        harness.until { pulls.get() >= 1 }
        assertTrue(viewModel.items.value!!.any { it.id == id(3) })
    }

    @Test
    fun aCategoryAlreadyGoneIsRefreshedAndNotReportedAsADeletion() {
        harness.route("/api/v1/ledgers/ledger-a/categories/${id(3)}") { problem(404, "Category not found.") }
        ask(3)
        viewModel.confirmDelete()
        harness.until { !viewModel.view.value.saving && viewModel.view.value.error != null }
        assertEquals(CategoryError.Rejected("Category not found."), viewModel.view.value.error)
        assertNull(viewModel.view.value.notice)
        harness.until { pulls.get() >= 1 }
    }

    @Test
    fun anAccountThatMayNotDeleteSeesThat() {
        harness.route("/api/v1/ledgers/ledger-a/categories/${id(3)}") { problem(403, "No.") }
        ask(3)
        viewModel.confirmDelete()
        harness.until { !viewModel.view.value.saving && viewModel.view.value.error != null }
        assertEquals(CategoryError.Forbidden, viewModel.view.value.error)
        assertTrue(viewModel.items.value!!.any { it.id == id(3) })
    }

    @Test
    fun aDeleteRetriedAfterAFailureKeepsItsKey() {
        harness.route("/api/v1/ledgers/ledger-a/categories/${id(3)}") { harness.json(500, "{}") }
        repeat(2) {
            ask(3)
            viewModel.confirmDelete()
            harness.until { !viewModel.view.value.saving && harness.recorded.size == it + 1 }
        }
        val keys = harness.recorded.map { it.idempotencyKey }
        assertEquals(keys[0], keys[1])
        assertEquals(CategoryError.Failed, viewModel.view.value.error)
    }

    @Test
    fun theDeleteQuestionCanBeDismissed() {
        ask(3)
        viewModel.dismissDeleteAsk()
        assertNull(viewModel.view.value.deleteAsk)
        assertTrue(harness.recorded.isEmpty())
    }
}
