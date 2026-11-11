package app.ledgerline.android.ui.clients

import app.ledgerline.android.mirror.MirrorStore
import app.ledgerline.android.mirror.PullSource
import app.ledgerline.android.mirror.Stamp
import app.ledgerline.android.mirror.SyncEngine
import app.ledgerline.android.mirror.SyncLock
import app.ledgerline.android.mirror.account
import app.ledgerline.android.mirror.changes
import app.ledgerline.android.mirror.id
import app.ledgerline.android.mirror.page
import app.ledgerline.android.mirror.syncCategory
import app.ledgerline.android.mirror.toRows
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.ReceiptWrites
import app.ledgerline.android.online.WriteError
import app.ledgerline.android.outbox.FakeServer
import app.ledgerline.android.outbox.PushEngine
import app.ledgerline.android.outbox.outboxFor
import app.ledgerline.android.settings.PaymentChoices
import app.ledgerline.android.sync.FakeLedgerChoice
import app.ledgerline.android.sync.FakeLookup
import app.ledgerline.android.sync.FakeScheduler
import app.ledgerline.android.sync.SyncCoordinator
import app.ledgerline.android.sync.SyncRunner
import app.ledgerline.android.testing.FakeClock
import app.ledgerline.android.testing.FakePaymentChoicesStore
import app.ledgerline.android.testing.OnlineHarness
import app.ledgerline.api.ApiJson
import app.ledgerline.api.Money
import app.ledgerline.api.Receipt
import app.ledgerline.api.ReceiptAllocation
import app.ledgerline.api.ReceiptPreview
import app.ledgerline.api.SyncResponse
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.atomic.AtomicInteger

private const val Ledger = "ledger-a"
private const val PreviewPath = "/api/v1/ledgers/ledger-a/contacts/northwind-design/receipt-preview\\?.*"
private const val ReceiptsPath = "/api/v1/ledgers/ledger-a/contacts/northwind-design/receipts"

/** The Record payment sheet for a client (ADR 0050, slice 4c): the real mirror and clients against a mock server, and the real write path. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class RecordReceiptViewModelTest {
    private val harness = OnlineHarness()
    private val store = FakePaymentChoicesStore()
    private val pulls = AtomicInteger()
    private lateinit var viewModel: RecordReceiptViewModel

    /** Owes 600.00 in two services: 450.00 (version 2, the older) and 150.00 (version 5). */
    private val client = contact("Northwind Design", owed = 60_000)
    private val open = listOf("s1" to (2 to 45_000L), "s2" to (5 to 15_000L))

    private val checking = id(1)
    private val savings = id(2)
    private val freelance = id(12)
    private val design = id(13)
    private val tips = id(14)

    private fun seed(categories: List<app.ledgerline.api.SyncCategory> = standardCategories()) = runBlocking {
        MirrorStore(harness.database).replaceAll(
            Ledger,
            changes(
                accounts = listOf(
                    account(1, name = "Everyday checking"), account(2, name = "Savings"), account(3, name = "Euro account", currency = "EUR"),
                    account(4, name = "Old account", archived = true), account(5, name = "Client balance", contactId = "northwind-design"),
                ),
                categories = categories,
            ).toRows(Ledger),
            "c0", Stamp,
        )
    }

    private fun standardCategories() = listOf(
        syncCategory(11, "Food"), syncCategory(12, "Freelance", kind = "income"), syncCategory(13, "Design work", kind = "income", parentN = 12),
        syncCategory(14, "Tips", kind = "income"), syncCategory(15, "Old income", kind = "income", archived = true),
    )

    /** What the server would answer: the amount applied to the open services, oldest first. */
    private fun previewFor(target: String): MockPreview {
        val amount = Regex("amount=(\\d+)").find(target)!!.groupValues[1].toLong()
        val currency = Regex("currency=([A-Z]+)").find(target)!!.groupValues[1]
        var left = amount
        val allocations = open.mapNotNull { (id, vo) ->
            if (left <= 0) return@mapNotNull null
            val take = minOf(left, vo.second)
            left -= take
            ReceiptAllocation(id, "Service $id", "2026-10-01", vo.first, Money(vo.second, currency), Money(take, currency), Money(vo.second - take, currency))
        }
        return MockPreview(ReceiptPreview("northwind-design", Money(amount, currency), Money(60_000, currency), left > 0, false, allocations), amount)
    }

    private class MockPreview(val preview: ReceiptPreview, val amount: Long)

    private fun routePreview() = harness.route(PreviewPath) { target ->
        harness.json(200, ApiJson.encodeToString(ReceiptPreview.serializer(), previewFor(target).preview))
    }

    private fun recorded() = harness.json(201, ApiJson.encodeToString(Receipt.serializer(), Receipt("r1", "northwind-design", Money(60_000, "USD"), listOf(payment(service("Service s1", 45_000), 45_000)))))

    private fun problem(status: Int, detail: String) =
        harness.json(status, """{"type":"about:blank","title":"x","status":$status,"detail":"$detail","errors":[]}""")

    private fun model(origin: String? = null, readOrigin: String? = null): RecordReceiptViewModel {
        val database = harness.database
        val lock = SyncLock()
        val source = object : PullSource {
            override suspend fun pull(ledgerId: String, cursor: String?, limit: Int): SyncResponse {
                pulls.incrementAndGet()
                return page()
            }
        }
        val engine = SyncEngine(source, MirrorStore(database), lock)
        val choice = FakeLedgerChoice(Ledger)
        val runner = SyncRunner(engine, PushEngine(FakeServer(), outboxFor(database), lock), FakeLookup(), choice, harness.session)
        val sync = SyncCoordinator(harness.session, runner, engine, FakeScheduler(), choice, FakeClock())
        val writer = if (origin == null) harness.writer() else harness.writer(origin)
        return RecordReceiptViewModel(database.reads(), ReceiptWrites(writer, if (readOrigin == null) harness.reader() else harness.reader(readOrigin)), sync, store).also {
            it.today = { "2026-11-10" }
            it.previewDelayMillis = 0
        }
    }

    @Before
    fun open() {
        harness.open()
        seed()
        routePreview()
        harness.route(ReceiptsPath) { recorded() }
        viewModel = model()
    }

    @After
    fun close() = harness.close()

    private fun openSheet(who: app.ledgerline.api.Contact = client): ReceiptUi {
        viewModel.open(who)
        harness.until { viewModel.sheet.value != null }
        return viewModel.sheet.value!!
    }

    private fun ui() = viewModel.sheet.value!!

    private fun previews() = harness.targets.filter { it.contains("receipt-preview") }

    private fun writes() = harness.recorded.filter { it.method == "POST" }

    /** A write happens on another thread, so "nothing was sent" is only true after a pause long enough for one to arrive. */
    private fun assertNothingWritten() {
        Thread.sleep(500)
        assertTrue(writes().isEmpty())
    }

    /** The sheet with an amount typed, the preview read and the account and category chosen. */
    private fun filled(amount: String = "600.00", tip: String? = null) {
        openSheet()
        viewModel.edit { it.copy(amount = amount, accountId = checking, categoryId = freelance, tipCategoryId = tip) }
        ready()
    }

    private fun ready() = harness.until { ui().preview is Online.Ready }

    private fun sent() {
        viewModel.save()
        viewModel.confirm()
        harness.until { viewModel.sheet.value?.saving != true }
    }

    @Test
    fun theSheetOpensEmptyInTheirCurrencyWithOnlyTheAccountsAndCategoriesThatFit() {
        val opened = openSheet()
        assertEquals("", opened.form.amount)
        assertEquals("USD", opened.form.currency)
        assertEquals("2026-11-10", opened.form.date)
        assertEquals(ReceiptTarget("northwind-design", "Northwind Design", listOf(Money(60_000, "USD"))), opened.form.target)
        assertEquals(listOf("Everyday checking", "Savings"), opened.accounts.map { it.label })
        assertTrue(opened.otherCurrencyAccounts)
        assertEquals(listOf("Freelance", "Freelance › Design work", "Tips"), opened.categories.map { it.label })
        assertFalse(opened.noIncomeCategory)
        assertNull(opened.preview)
        assertEquals(listOf("USD"), opened.currencies)
        assertTrue(harness.quiet())
    }

    @Test
    fun aClientWhoOwesNothingOpensNoSheet() {
        viewModel.open(contact("Settled Co"))
        assertTrue(harness.quiet())
        assertNull(viewModel.sheet.value)
    }

    @Test
    fun aLedgerWithoutAnIncomeCategoryIsToldSo() {
        seed(categories = listOf(syncCategory(11, "Food")))
        assertTrue(openSheet().noIncomeCategory)
    }

    @Test
    fun theChoicesOfTheLastPaymentFillTheFormWhenTheyAreStillOfferedAndOthersAreIgnored() {
        store.choices = PaymentChoices(accountId = savings, categoryId = tips, tipCategoryId = design)
        val opened = openSheet()
        assertEquals(savings, opened.form.accountId)
        assertEquals(tips, opened.form.categoryId)
        assertEquals(design, opened.form.tipCategoryId)
        viewModel.close()
        store.choices = PaymentChoices(accountId = id(3), categoryId = id(11), tipCategoryId = "gone")
        val ignored = openSheet()
        assertNull(ignored.form.accountId)
        assertNull(ignored.form.categoryId)
        assertNull(ignored.form.tipCategoryId)
    }

    @Test
    fun aClientWhoOwesInSeveralCurrenciesCanChooseOneAndTheAccountsFollow() {
        val both = contact("Northwind Design", balances = listOf(Money(60_000, "USD"), Money(20_000, "EUR")), owed = 60_000)
        val opened = openSheet(both)
        assertEquals(listOf("USD", "EUR"), opened.currencies)
        viewModel.edit { it.copy(amount = "10.00", accountId = checking) }
        viewModel.chooseCurrency("EUR")
        assertEquals("EUR", ui().form.currency)
        assertEquals("", ui().form.amount)
        assertNull(ui().form.accountId)
        assertEquals(listOf("Euro account"), ui().accounts.map { it.label })
        assertTrue(ui().otherCurrencyAccounts)
        assertNull(ui().preview)
    }

    @Test
    fun choosingTheCurrencyAlreadyChosenChangesNothing() {
        openSheet(contact("Northwind Design", balances = listOf(Money(60_000, "USD"), Money(20_000, "EUR")), owed = 60_000))
        viewModel.edit { it.copy(amount = "10.00", accountId = checking) }
        viewModel.chooseCurrency("USD")
        assertEquals("10.00", ui().form.amount)
        assertEquals(checking, ui().form.accountId)
    }

    @Test
    fun anAmountReadsWhichServicesItPaysOldestFirst() {
        openSheet()
        viewModel.edit { it.copy(amount = "500.00") }
        ready()
        val preview = (ui().preview as Online.Ready).value
        assertEquals(listOf("s1", "s2"), preview.allocations.map { it.receivableId })
        assertEquals(1, previews().size)
        assertTrue(previews().single().contains("amount=50000"))
        assertTrue(previews().single().contains("currency=USD"))
    }

    @Test
    fun moneyOverTheTotalAsksForTheOpenTotalOnly() {
        openSheet()
        viewModel.edit { it.copy(amount = "650.00") }
        ready()
        assertTrue(previews().single().contains("amount=60000"))
    }

    @Test
    fun noReadHappensWithoutAValidAmountAndAnEmptiedAmountClearsThePreview() {
        openSheet()
        viewModel.edit { it.copy(amount = "abc") }
        assertTrue(harness.quiet())
        assertNull(ui().preview)
        viewModel.edit { it.copy(amount = "10.00") }
        ready()
        viewModel.edit { it.copy(amount = "") }
        assertNull(ui().preview)
    }

    @Test
    fun editingSomethingElseDoesNotReadTheServicesAgain() {
        filled()
        viewModel.edit { it.copy(note = "Cash") }
        viewModel.edit { it.copy(accountId = savings) }
        assertEquals(1, previews().size)
        assertTrue(ui().preview is Online.Ready)
    }

    @Test
    fun theAmountReadsOnlyOnceItHasRestedAndOnlyTheLastOneIsAsked() {
        viewModel.previewDelayMillis = 300
        openSheet()
        viewModel.edit { it.copy(amount = "1.00") }
        assertEquals(Online.Loading, ui().preview)
        viewModel.edit { it.copy(amount = "12.00") }
        viewModel.edit { it.copy(amount = "123.00") }
        ready()
        assertEquals(1, previews().size)
        assertTrue(previews().single().contains("amount=12300"))
    }

    @Test
    fun anOlderAnswerThatArrivesLateNeverReplacesTheNewerAmountsPreview() {
        harness.delayMillis = 300
        openSheet()
        viewModel.edit { it.copy(amount = "100.00") }
        harness.until { previews().isNotEmpty() }
        viewModel.edit { it.copy(amount = "200.00") }
        ready()
        assertEquals(20_000L, (ui().preview as Online.Ready).value.amount.amount)
        harness.delayMillis = 0
    }

    @Test
    fun payFullBalanceFillsTheAmountAndReadsTheServicesItPays() {
        openSheet()
        viewModel.payInFull()
        assertEquals("600.00", ui().form.amount)
        ready()
        assertEquals(60_000L, (ui().preview as Online.Ready).value.amount.amount)
    }

    @Test
    fun aReadThatFailedShowsItAndSaveTriesItAgain() {
        harness.route(PreviewPath) { harness.json(500) }
        openSheet()
        viewModel.edit { it.copy(amount = "600.00", accountId = checking, categoryId = freelance) }
        harness.until { ui().preview == Online.Failed }
        routePreview()
        viewModel.save()
        assertEquals(setOf(ReceiptProblem.PreviewNotReady), ui().errors)
        assertFalse(ui().asking)
        ready()
        viewModel.save()
        assertTrue(ui().asking)
    }

    @Test
    fun anOfflinePhoneSaysTheReadDidNotHappen() {
        viewModel = model(readOrigin = harness.closedOrigin())
        openSheet()
        viewModel.edit { it.copy(amount = "600.00") }
        harness.until { ui().preview == Online.Offline }
    }

    @Test
    fun savingWithAProblemShowsItAndAsksNothing() {
        openSheet()
        viewModel.save()
        assertEquals(setOf(ReceiptProblem.AmountMissing, ReceiptProblem.AccountMissing, ReceiptProblem.CategoryMissing), ui().errors)
        assertFalse(ui().asking)
        assertNothingWritten()
    }

    @Test
    fun savingBeforeTheServicesAreReadAsksNothingAndSaysWhy() {
        viewModel.previewDelayMillis = 400
        openSheet()
        viewModel.edit { it.copy(amount = "600.00", accountId = checking, categoryId = freelance) }
        viewModel.save()
        assertEquals(setOf(ReceiptProblem.PreviewNotReady), ui().errors)
        assertFalse(ui().asking)
        assertNothingWritten()
    }

    @Test
    fun editingClearsTheProblemsAndTheLastError() {
        openSheet()
        viewModel.save()
        viewModel.edit { it.copy(accountId = checking) }
        assertTrue(ui().errors.isEmpty())
        assertNull(ui().error)
    }

    @Test
    fun aValidFormAsksFirstAndSendsNothingUntilItIsConfirmed() {
        filled()
        viewModel.save()
        assertTrue(ui().asking)
        assertTrue(ui().errors.isEmpty())
        assertNothingWritten()
    }

    @Test
    fun decliningTheQuestionSendsNothingAndKeepsTheForm() {
        filled()
        viewModel.save()
        viewModel.dismissAsk()
        assertFalse(ui().asking)
        assertEquals(checking, ui().form.accountId)
        assertNothingWritten()
    }

    @Test
    fun changingTheAmountWithdrawsTheQuestionSoOnlyWhatWasShownCanBeConfirmed() {
        filled()
        viewModel.save()
        viewModel.edit { it.copy(amount = "100.00") }
        assertFalse(ui().asking)
        viewModel.confirm()
        assertNothingWritten()
    }

    @Test
    fun confirmingWithoutBeingAskedSendsNothing() {
        filled()
        viewModel.confirm()
        assertNothingWritten()
    }

    @Test
    fun confirmingSendsOneReceiptNamingThePreviewsServicesWithItsKeyAndTheToken() {
        filled()
        sent()
        val write = writes().single()
        assertEquals(ReceiptsPath, write.target)
        assertEquals(
            """{"amount":{"amount":60000,"currency":"USD"},"accountId":"$checking","categoryId":"$freelance","date":"2026-11-10",""" +
                """"expectedAllocations":[{"receivableId":"s1","expectedVersion":2,"applied":45000},{"receivableId":"s2","expectedVersion":5,"applied":15000}]}""",
            write.body,
        )
        assertTrue(Regex("^rcpt-[A-Za-z0-9._:-]{8,120}$").matches(write.idempotencyKey.orEmpty()))
        assertEquals("Bearer tok", harness.tokens.last())
    }

    @Test
    fun aPartialAmountPaysTheOldestServiceInFullAndPartOfTheNext() {
        filled(amount = "500.00")
        sent()
        assertTrue(writes().single().body.contains(""""expectedAllocations":[{"receivableId":"s1","expectedVersion":2,"applied":45000},{"receivableId":"s2","expectedVersion":5,"applied":5000}]"""))
    }

    @Test
    fun moneyOverTheTotalIsSentAsOneTipWithItsOwnCategory() {
        filled(amount = "650.00", tip = tips)
        sent()
        val body = writes().single().body
        assertTrue(body.contains(""""amount":{"amount":60000,"currency":"USD"}"""))
        assertTrue(body.contains(""""tip":{"amount":{"amount":5000,"currency":"USD"},"categoryId":"$tips"}"""))
    }

    @Test
    fun aTipWithoutACategoryIsAProblemAndNothingIsAsked() {
        filled(amount = "650.00")
        viewModel.save()
        assertEquals(setOf(ReceiptProblem.TipCategoryMissing), ui().errors)
        assertFalse(ui().asking)
    }

    @Test
    fun aPaymentThatWentThroughClosesTheSheetRemembersTheChoicesAndTellsTheScreenToReadAgain() {
        filled()
        assertEquals(0, viewModel.reread.value)
        sent()
        harness.until { viewModel.sheet.value == null }
        assertEquals(1, viewModel.reread.value)
        assertEquals(PaymentChoices(accountId = checking, categoryId = freelance, tipCategoryId = null), store.choices)
        harness.until { pulls.get() >= 1 }
    }

    @Test
    fun theTipCategoryIsRememberedOnlyWhenATipWasSent() {
        store.choices = PaymentChoices(tipCategoryId = design)
        filled(tip = tips)
        sent()
        harness.until { viewModel.sheet.value == null }
        assertEquals(PaymentChoices(accountId = checking, categoryId = freelance, tipCategoryId = design), store.choices)
        filled(amount = "650.00", tip = tips)
        sent()
        harness.until { viewModel.sheet.value == null }
        assertEquals(tips, store.choices.tipCategoryId)
    }

    @Test
    fun aFailedSendKeepsTheFormAndATryAgainCarriesTheSameKey() {
        harness.route(ReceiptsPath) { harness.json(500) }
        filled()
        sent()
        assertEquals(WriteError.Failed, ui().error)
        assertEquals(checking, ui().form.accountId)
        assertFalse(ui().saving)
        assertEquals(0, viewModel.reread.value)
        harness.route(ReceiptsPath) { recorded() }
        sent()
        harness.until { viewModel.sheet.value == null }
        val keys = writes().map { it.idempotencyKey }
        assertEquals(2, keys.size)
        assertEquals(keys[0], keys[1])
    }

    @Test
    fun aChangedPaymentGetsANewKey() {
        harness.route(ReceiptsPath) { harness.json(500) }
        filled()
        sent()
        viewModel.edit { it.copy(amount = "400.00") }
        ready()
        sent()
        val keys = writes().map { it.idempotencyKey }
        assertEquals(2, keys.size)
        assertNotEquals(keys[0], keys[1])
    }

    @Test
    fun anOfflinePhoneKeepsTheFormAndSaysSo() {
        viewModel = model(origin = harness.closedOrigin())
        filled()
        sent()
        assertEquals(WriteError.Offline, ui().error)
        assertEquals(freelance, ui().form.categoryId)
        assertFalse(ui().saving)
        assertEquals(0, viewModel.reread.value)
    }

    @Test
    fun aServiceThatChangedMeanwhileShowsTheServersSentenceReadsTheScreenAndTheServicesAgain() {
        harness.route(ReceiptsPath) { problem(409, "A service changed. Reload and try again.") }
        filled()
        sent()
        assertEquals(WriteError.Rejected("A service changed. Reload and try again."), ui().error)
        assertEquals(1, viewModel.reread.value)
        harness.until { pulls.get() >= 1 }
        harness.until { previews().size >= 2 }
    }

    @Test
    fun aRefusalThatIsNotStaleShowsTheSentenceWithoutReadingAgain() {
        harness.route(ReceiptsPath) { problem(422, "Choose an income category.") }
        filled()
        sent()
        assertEquals(WriteError.Rejected("Choose an income category."), ui().error)
        assertEquals(0, viewModel.reread.value)
        assertEquals(0, pulls.get())
        assertEquals(1, previews().size)
    }

    @Test
    fun aViewerIsToldTheyCannotChangeTheLedger() {
        harness.route(ReceiptsPath) { harness.json(403) }
        filled()
        sent()
        assertEquals(WriteError.Forbidden, ui().error)
    }

    @Test
    fun aSecondConfirmWhileSavingSendsNothingMore() {
        filled()
        harness.delayMillis = 400
        viewModel.save()
        viewModel.confirm()
        assertTrue(ui().saving)
        viewModel.confirm()
        viewModel.save()
        harness.until { viewModel.sheet.value == null }
        assertEquals(1, writes().size)
        harness.delayMillis = 0
    }

    @Test
    fun nothingCanBeEditedWhileAPaymentIsBeingSent() {
        filled()
        harness.delayMillis = 400
        viewModel.save()
        viewModel.confirm()
        assertTrue(ui().saving)
        viewModel.edit { it.copy(amount = "1.00") }
        assertEquals("600.00", ui().form.amount)
        harness.until { viewModel.sheet.value == null }
        harness.delayMillis = 0
    }

    @Test
    fun aZeroBalanceBesideARealOneIsNotACurrencyTheyOweIn() {
        val mixed = contact("Northwind Design", balances = listOf(Money(0, "USD"), Money(20_000, "EUR")), owed = 0)
        val opened = openSheet(mixed)
        assertEquals(listOf("EUR"), opened.currencies)
        assertEquals("EUR", opened.form.currency)
    }

    @Test
    fun aClientWhoseOnlyBalanceIsZeroOpensNoSheet() {
        viewModel.open(contact("Northwind Design", balances = listOf(Money(0, "USD")), owed = 0))
        assertTrue(harness.quiet())
        assertNull(viewModel.sheet.value)
    }

    @Test
    fun theSheetCannotBeClosedWhileSavingAndClosingForgetsItsKeys() {
        harness.route(ReceiptsPath) { harness.json(500) }
        filled()
        sent()
        val first = writes().single().idempotencyKey
        harness.delayMillis = 300
        viewModel.save()
        viewModel.confirm()
        viewModel.close()
        assertTrue(viewModel.sheet.value != null)
        harness.until { viewModel.sheet.value?.saving != true }
        harness.delayMillis = 0
        viewModel.close()
        assertNull(viewModel.sheet.value)
        filled()
        sent()
        assertNotEquals(first, writes().last().idempotencyKey)
    }
}
