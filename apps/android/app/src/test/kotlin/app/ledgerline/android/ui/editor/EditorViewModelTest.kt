package app.ledgerline.android.ui.editor

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
import app.ledgerline.android.outbox.FakeWallClock
import app.ledgerline.android.outbox.OutboxRow
import app.ledgerline.android.outbox.OutboxStore
import app.ledgerline.android.outbox.PushEngine
import app.ledgerline.android.outbox.memoryDatabase
import app.ledgerline.android.outbox.outboxFor
import app.ledgerline.android.outbox.rejected
import app.ledgerline.android.overlay.LedgerView
import app.ledgerline.android.session.SessionManager
import app.ledgerline.android.sync.FakeLedgerChoice
import app.ledgerline.android.sync.FakeLookup
import app.ledgerline.android.sync.FakeScheduler
import app.ledgerline.android.sync.HoldableSource
import app.ledgerline.android.sync.SyncCoordinator
import app.ledgerline.android.sync.SyncRunner
import app.ledgerline.android.testing.FakeClock
import app.ledgerline.android.testing.FakeTokenProtector
import app.ledgerline.api.ApiJson
import app.ledgerline.api.SyncCategory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.jsonObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Instant

class FakeFormMemory(var lastAccount: String? = null, val categories: MutableMap<String, String?> = mutableMapOf()) : FormMemory {
    override fun account() = lastAccount

    override fun category(kind: String) = categories[kind]

    override fun remember(accountId: String, kind: String, categoryId: String?) {
        lastAccount = accountId
        if (kind != "transfer") categories[kind] = categoryId
    }
}

/** The editor against the real Room mirror and outbox. The session is signed out here, so nothing is sent. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class EditorViewModelTest {
    private lateinit var database: MirrorDatabase
    private lateinit var outbox: OutboxStore
    private lateinit var sync: SyncCoordinator
    private lateinit var writes: app.ledgerline.android.online.CategoryWrites
    private val memory = FakeFormMemory()
    private val ledger = "ledger-a"
    private val clock = FakeWallClock(Instant.parse("2026-10-22T15:00:00Z"))

    private fun category(n: Int, name: String, kind: String = "expense", parent: Int? = null) =
        SyncCategory(id(n), Stamp, Stamp, null, 1, parent?.let { id(it) }, name, kind, null, null, 0, null)

    @Before
    fun open() = runBlocking {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        database = memoryDatabase()
        outbox = outboxFor(database, clock)
        val session = SessionManager(FakeTokenProtector(), FakeClock())
        writes = app.ledgerline.android.online.CategoryWrites(
            app.ledgerline.android.online.OnlineWriter(app.ledgerline.android.testing.FakeServerAddressStore(null), app.ledgerline.android.session.ClientsProvider(session), session),
            MirrorStore(database),
        )
        val lock = SyncLock()
        val engine = SyncEngine(HoldableSource { page() }, MirrorStore(database), lock)
        val choice = FakeLedgerChoice(ledger)
        sync = SyncCoordinator(session, SyncRunner(engine, PushEngine(FakeServer(), outbox, lock), FakeLookup(), choice, session), engine, FakeScheduler(), choice, FakeClock())
        MirrorStore(database).replaceAll(
            ledger,
            changes(
                accounts = listOf(
                    account(1, name = "Checking"),
                    account(2, name = "Cash"),
                    account(3, name = "Yen").copy(currency = "JPY", openingBalance = app.ledgerline.api.Money(0, "JPY")),
                    account(4, name = "Client").copy(contactId = id(99)),
                    account(5, name = "Old").copy(archivedAt = Stamp),
                ),
                tags = listOf(tag(30, name = "work")),
                transactions = listOf(
                    entry(10, accountN = 1, amount = -1_000, payee = "Grocer").copy(categoryId = id(20), time = "18:20"),
                    entry(11, accountN = 1, amount = -3_000, payee = "Split").copy(isSplit = true),
                    entry(12, accountN = 1, amount = -100, payee = "Fee").copy(feeTransferId = "t2"),
                    entry(40, accountN = 1, amount = -500, kind = "transfer", payee = null).copy(transferId = "t1", time = "08:30"),
                    entry(41, accountN = 2, amount = 500, kind = "transfer", payee = null).copy(transferId = "t1", time = "08:30"),
                    entry(42, accountN = 1, amount = -700, kind = "transfer", payee = null).copy(transferId = "t2"),
                    entry(43, accountN = 2, amount = 700, kind = "transfer", payee = null).copy(transferId = "t2"),
                ),
            ).copy(categories = listOf(category(20, "Food"), category(21, "Fun", parent = 20), category(22, "Salary", "income"))).toRows(ledger),
            "c",
            Stamp,
        )
    }

    @After
    fun close() {
        database.close()
        Dispatchers.resetMain()
    }

    private fun editor() = EditorViewModel(database.reads(), database.dao(), LedgerView(database.reads(), database.dao(), database.outbox()), outbox, sync, memory, clock, writes)

    private var sessions = 0

    private suspend fun EditorViewModel.opened(target: EditorTarget, session: String = "s${++sessions}"): EditorState {
        open(target, session)
        return withTimeout(5_000) { state.first { it != null && it.session == session }!! }
    }

    private suspend fun EditorViewModel.saved() = withTimeout(5_000) { state.first { it?.done == true || it?.errors?.isNotEmpty() == true }!! }

    private suspend fun rows() = database.outbox().all()

    private fun body(row: OutboxRow) = ApiJson.parseToJsonElement(row.body).jsonObject

    @Test
    fun aNewExpenseNeedsOnlyTheAmountAndSavesASignedAmountInTheAccountsCurrency() = runBlocking {
        memory.lastAccount = id(2)
        memory.categories["expense"] = id(20)
        val vm = editor()
        val state = vm.opened(EditorTarget.New())
        assertEquals(listOf(EntryMode.Expense, EntryMode.Income, EntryMode.Transfer), state.modes)
        assertEquals(id(2), state.form.accountId)
        assertEquals(id(20), state.form.categoryId)
        assertEquals("2026-10-22", state.form.date)
        assertEquals(listOf("Cash", "Checking", "Yen"), state.accounts.map { it.label })
        assertEquals(listOf("Food", "Food › Fun"), state.categories.map { it.label })
        vm.update { it.copy(amount = "12.5", payee = " Cafe ", tagIds = listOf(id(30))) }
        vm.save()
        assertTrue(vm.saved().done)
        val row = rows().single()
        assertEquals("transaction.create", row.type)
        assertEquals(
            """{"accountId":"${id(2)}","categoryId":"${id(20)}","kind":"expense","date":"2026-10-22","time":null,"amount":{"amount":-1250,"currency":"USD"},"status":"cleared","payee":"Cafe","note":null,"tagIds":["${id(30)}"]}""",
            row.body,
        )
        assertEquals(id(2), memory.lastAccount)
    }

    @Test
    fun theSameEditorOpenedAgainStartsFreshAfterASave() = runBlocking {
        memory.categories["expense"] = id(20)
        val vm = editor()
        vm.opened(EditorTarget.New())
        vm.update { it.copy(amount = "1") }
        vm.save()
        assertTrue(vm.saved().done)
        val again = vm.opened(EditorTarget.New())
        assertEquals(false, again.done)
        assertEquals("", again.form.amount)
        vm.update { it.copy(amount = "2") }
        vm.save()
        assertTrue(vm.saved().done)
        assertEquals(2, rows().size)
    }

    @Test
    fun aRotationKeepsTheFormAndAnEntryCanBeOpenedTwice() = runBlocking {
        val vm = editor()
        vm.opened(EditorTarget.Entry(id(10)), session = "one")
        vm.update { it.copy(payee = "Typed") }
        vm.open(EditorTarget.Entry(id(10)), "one")
        assertEquals("Typed", vm.state.value!!.form.payee)
        vm.save()
        assertTrue(vm.saved().done)
        // Opened again: a fresh form showing the saved (not yet sent) edit, not the finished one.
        val again = vm.opened(EditorTarget.Entry(id(10)), session = "two")
        assertEquals(false, again.done)
        assertEquals("Typed", again.form.payee)
    }

    @Test
    fun incomeIsPositiveAndSwitchingKindPicksThatKindsCategory() = runBlocking {
        memory.categories["income"] = id(22)
        val vm = editor()
        vm.opened(EditorTarget.New())
        vm.update { it.copy(mode = EntryMode.Income, amount = "2500") }
        assertEquals(id(22), vm.state.value!!.form.categoryId)
        assertEquals(listOf("Salary"), vm.state.value!!.categories.map { it.label })
        vm.save()
        vm.saved()
        assertEquals("""{"amount":250000,"currency":"USD"}""", body(rows().single())["amount"].toString())
    }

    @Test
    fun mistakesAreShownAndNothingIsSaved() = runBlocking {
        memory.categories["expense"] = id(20)
        val vm = editor()
        vm.opened(EditorTarget.New())
        vm.save()
        assertEquals(setOf(FormError.AmountMissing), vm.saved().errors)
        vm.update { it.copy(accountId = id(3), amount = "12.5") }
        vm.save()
        assertEquals(setOf(FormError.AmountTooPrecise), vm.saved().errors)
        assertTrue(rows().isEmpty())
    }

    @Test
    fun anExpenseOrIncomeNeedsACategoryAsOnTheWeb() = runBlocking {
        val vm = editor()
        val state = vm.opened(EditorTarget.New())
        assertNull(state.form.categoryId)
        vm.update { it.copy(amount = "5") }
        vm.save()
        assertEquals(setOf(FormError.CategoryMissing), vm.saved().errors)
        assertTrue(rows().isEmpty())
        // Choosing one clears the error and saves.
        vm.update { it.copy(categoryId = id(20)) }
        assertTrue(vm.state.value!!.errors.isEmpty())
        vm.save()
        assertTrue(vm.saved().done)
        assertEquals(1, rows().size)
    }

    @Test
    fun aTransferNeedsNoCategory() = runBlocking {
        val vm = editor()
        vm.opened(EditorTarget.New())
        // Switching kind clears the second account, so it is chosen in a second step, as on screen.
        vm.update { it.copy(mode = EntryMode.Transfer, accountId = id(1), amount = "10") }
        vm.update { it.copy(toAccountId = id(2)) }
        vm.save()
        assertTrue(vm.saved().done)
    }

    @Test
    fun anOlderEntryWithoutACategoryAsksForOneBeforeItCanBeSavedAgain() = runBlocking {
        val created = outbox.createEntry(ledger, entryCreateBody(EntryValues("expense", id(1), null, "2026-10-22", -500, "USD", "Cafe", null, emptyList())))
        val vm = editor()
        assertNull(vm.opened(EditorTarget.Entry(created)).form.categoryId)
        vm.update { it.copy(payee = "Cafe 2") }
        vm.save()
        assertEquals(setOf(FormError.CategoryMissing), vm.saved().errors)
    }

    @Test
    fun editingAnEntrySendsOnlyWhatChanged() = runBlocking {
        val vm = editor()
        val state = vm.opened(EditorTarget.Entry(id(10)))
        assertEquals("10.00", state.form.amount)
        assertEquals("Grocer", state.form.payee)
        assertEquals(listOf(EntryMode.Expense, EntryMode.Income), state.modes)
        assertTrue(state.canDelete)
        vm.update { it.copy(payee = "Baker") }
        vm.save()
        vm.saved()
        val row = rows().single()
        assertEquals("transaction.update", row.type)
        assertEquals(id(10), row.entityId)
        assertEquals("""{"payee":"Baker"}""", row.body)
    }

    @Test
    fun aNewEntryHasNoTimeUntilTheOwnerAddsOne() = runBlocking {
        memory.categories["expense"] = id(20)
        val vm = editor()
        assertNull(vm.opened(EditorTarget.New()).form.time)
        vm.update { it.copy(amount = "4", time = "07:45") }
        vm.save()
        vm.saved()
        assertTrue(rows().single().body.contains(""""date":"2026-10-22","time":"07:45","""))
    }

    @Test
    fun anEntrysTimeShowsWhenOpenedAndClearingItSendsNull() = runBlocking {
        val vm = editor()
        assertEquals("18:20", vm.opened(EditorTarget.Entry(id(10))).form.time)
        vm.update { it.copy(time = null) }
        vm.save()
        vm.saved()
        assertEquals("""{"time":null}""", rows().single().body)
    }

    @Test
    fun savingAnUnchangedEntrySendsNothing() = runBlocking {
        val vm = editor()
        vm.opened(EditorTarget.Entry(id(10)))
        vm.save()
        assertTrue(vm.saved().done)
        assertTrue(rows().isEmpty())
    }

    @Test
    fun deletingAnEntryQueuesADelete() = runBlocking {
        val vm = editor()
        vm.opened(EditorTarget.Entry(id(10)))
        vm.delete()
        vm.saved()
        assertEquals("transaction.delete", rows().single().type)
    }

    @Test
    fun editingAnUnsentEntryChangesItsCreate() = runBlocking {
        val created = outbox.createEntry(ledger, entryCreateBody(EntryValues("expense", id(1), id(20), "2026-10-22", -500, "USD", "Cafe", null, emptyList())))
        val vm = editor()
        assertEquals("5.00", vm.opened(EditorTarget.Entry(created)).form.amount)
        vm.update { it.copy(amount = "6") }
        vm.save()
        vm.saved()
        val row = rows().single()
        assertEquals("transaction.create", row.type)
        assertEquals("""{"amount":-600,"currency":"USD"}""", body(row)["amount"].toString())
    }

    @Test
    fun aNewTransferOffersOnlyOtherAccountsInTheSameCurrency() = runBlocking {
        val vm = editor()
        vm.opened(EditorTarget.New())
        vm.update { it.copy(mode = EntryMode.Transfer, accountId = id(1), amount = "50", note = "rent") }
        assertEquals(listOf("Cash"), vm.state.value!!.toAccounts.map { it.label })
        vm.save()
        assertEquals(setOf(FormError.ToAccountMissing), vm.saved().errors)
        vm.update { it.copy(toAccountId = id(2)) }
        vm.save()
        vm.saved()
        assertEquals(
            """{"fromAccountId":"${id(1)}","toAccountId":"${id(2)}","amount":{"amount":5000,"currency":"USD"},"date":"2026-10-22","time":null,"note":"rent"}""",
            rows().single().body,
        )
    }

    @Test
    fun aTransferLegOpensItsTransferAndAnEditSendsTheWholeTransferKeepingItsTime() = runBlocking {
        val vm = editor()
        val state = vm.opened(EditorTarget.Entry(id(41)))
        assertEquals(EntryMode.Transfer, state.form.mode)
        assertEquals(id(1) to id(2), state.form.accountId to state.form.toAccountId)
        assertEquals("5.00", state.form.amount)
        assertEquals("08:30", state.form.time)
        vm.update { it.copy(amount = "7.25") }
        vm.save()
        vm.saved()
        val row = rows().single()
        assertEquals("transfer.update", row.type)
        assertEquals("t1", row.entityId)
        assertEquals(
            """{"fromAccountId":"${id(1)}","toAccountId":"${id(2)}","amount":{"amount":725,"currency":"USD"},"date":"2026-10-20","time":"08:30","note":null}""",
            row.body,
        )
    }

    @Test
    fun aTransfersNewTimeIsSent() = runBlocking {
        val vm = editor()
        vm.opened(EditorTarget.Entry(id(41)))
        vm.update { it.copy(time = "21:10") }
        vm.save()
        vm.saved()
        assertTrue(rows().single().body.contains(""""time":"21:10""""))
    }

    @Test
    fun splitLinkedAndFeeTransfersAreReadOnly() = runBlocking {
        assertEquals(ReadOnly.Split, editor().opened(EditorTarget.Entry(id(11))).readOnly)
        assertEquals(ReadOnly.Linked, editor().opened(EditorTarget.Entry(id(12))).readOnly)
        assertEquals(ReadOnly.TransferExtras, editor().opened(EditorTarget.Transfer("t2")).readOnly)
        assertEquals(ReadOnly.Gone, editor().opened(EditorTarget.Entry("missing")).readOnly)
        // Neither save nor delete starts on a read-only entry (both would mark the state as saving at once).
        val vm = editor()
        vm.opened(EditorTarget.Entry(id(11)))
        vm.save()
        assertEquals(false, vm.state.value!!.saving || vm.state.value!!.done)
        vm.delete()
        assertEquals(false, vm.state.value!!.saving || vm.state.value!!.done)
        assertTrue(rows().isEmpty())
    }

    @Test
    fun aRejectedNewEntryCanBeCorrectedAndSentAgainAsANewChange() = runBlocking {
        val created = outbox.createEntry(ledger, entryCreateBody(EntryValues("expense", id(1), id(20), "2026-10-22", -500, "USD", "Cafe", null, emptyList())))
        val batch = outbox.takeBatch(ledger)
        outbox.settle(ledger, batch, listOf(rejected(created)))
        val vm = editor()
        val state = vm.opened(EditorTarget.Fix(created))
        assertEquals("5.00", state.form.amount)
        assertEquals("Cafe", state.form.payee)
        vm.update { it.copy(accountId = id(2)) }
        vm.save()
        vm.saved()
        val row = rows().single()
        assertEquals(OutboxRow.Pending, row.state)
        assertTrue(row.id != created)
        assertEquals(id(2), body(row)["accountId"]!!.toString().trim('"'))
    }

    @Test
    fun aRejectedEditIsSentAgainAgainstTheCurrentEntry() = runBlocking {
        outbox.updateEntry(ledger, id(10), kotlinx.serialization.json.buildJsonObject { put("payee", kotlinx.serialization.json.JsonPrimitive("Bad")) })
        val batch = outbox.takeBatch(ledger)
        outbox.settle(ledger, batch, listOf(rejected(batch.single().id)))
        val vm = editor()
        assertEquals("Bad", vm.opened(EditorTarget.Fix(batch.single().id)).form.payee)
        vm.update { it.copy(payee = "Good") }
        vm.save()
        vm.saved()
        val row = rows().single()
        assertEquals("transaction.update", row.type)
        assertEquals("""{"payee":"Good"}""", row.body)
        assertNull(rows().find { it.id == batch.single().id })
    }
}
