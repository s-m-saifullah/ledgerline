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
import app.ledgerline.android.online.PaymentWrites
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
import app.ledgerline.api.ServicePayment
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
private const val PaymentsPath = "/api/v1/ledgers/ledger-a/receivables/logo-refresh/payments"

/** The Record payment sheet's logic (ADR 0050): the real mirror and clients against a mock server, and the real write path. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class RecordPaymentViewModelTest {
    private val harness = OnlineHarness()
    private val store = FakePaymentChoicesStore()
    private val pulls = AtomicInteger()
    private lateinit var viewModel: RecordPaymentViewModel

    private val logo = service("Logo refresh", 45_000, due = "2026-10-10")

    // Accounts: 1 and 2 are the ones to offer; 3 is in euros, 4 archived, 5 is a balance account kept for a client.
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

    private fun paid(cents: Long = 45_000) = harness.json(201, ApiJson.encodeToString(ServicePayment.serializer(), payment(logo, cents)))

    private fun problem(status: Int, detail: String) =
        harness.json(status, """{"type":"about:blank","title":"x","status":$status,"detail":"$detail","errors":[]}""")

    private fun model(origin: String? = null): RecordPaymentViewModel {
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
        return RecordPaymentViewModel(database.reads(), PaymentWrites(writer), sync, store).also { it.today = { "2026-11-09" } }
    }

    @Before
    fun open() {
        harness.open()
        seed()
        harness.route(PaymentsPath) { paid() }
        viewModel = model()
    }

    @After
    fun close() = harness.close()

    private fun openSheet(service: app.ledgerline.api.Service = logo): PaymentUi {
        viewModel.open(service, "Northwind Design")
        harness.until { viewModel.sheet.value != null }
        return viewModel.sheet.value!!
    }

    private fun ui() = viewModel.sheet.value!!

    private fun filled() {
        openSheet()
        viewModel.edit { it.copy(accountId = checking, categoryId = freelance) }
    }

    private fun writes() = harness.recorded.filter { it.method == "POST" }

    private fun sent() {
        viewModel.save()
        viewModel.confirm()
        harness.until { viewModel.sheet.value?.saving != true }
    }

    @Test
    fun theSheetOpensWithTheFullAmountTodayAndOnlyTheAccountsAndCategoriesThatFit() {
        val opened = openSheet()
        assertEquals("450.00", opened.form.amount)
        assertEquals("2026-11-09", opened.form.date)
        assertEquals(PaymentTarget("logo-refresh", 1, "Logo refresh", "Northwind Design", "USD", 45_000), opened.form.target)
        // Archived, other-currency and client balance accounts are left out; the euro account is why the hint shows.
        assertEquals(listOf("Everyday checking", "Savings"), opened.accounts.map { it.label })
        assertTrue(opened.otherCurrencyAccounts)
        // Income categories only, a subcategory under its main one, the archived one left out.
        assertEquals(listOf("Freelance", "Freelance › Design work", "Tips"), opened.categories.map { it.label })
        assertFalse(opened.noIncomeCategory)
        assertFalse(opened.saving)
        assertFalse(opened.asking)
        assertNull(opened.error)
    }

    @Test
    fun noHintShowsWhenEveryAccountIsInTheServicesCurrency() {
        runBlocking {
            MirrorStore(harness.database).replaceAll(Ledger, changes(accounts = listOf(account(1, name = "Everyday checking")), categories = standardCategories()).toRows(Ledger), "c0", Stamp)
        }
        assertFalse(openSheet().otherCurrencyAccounts)
    }

    @Test
    fun aLedgerWithoutAnIncomeCategoryIsToldSo() {
        seed(categories = listOf(syncCategory(11, "Food")))
        val opened = openSheet()
        assertTrue(opened.noIncomeCategory)
        assertEquals(emptyList<String>(), opened.categories.map { it.label })
    }

    @Test
    fun theChoicesOfTheLastPaymentFillTheFormWhenTheyAreStillOffered() {
        store.choices = PaymentChoices(accountId = savings, categoryId = tips, tipCategoryId = design)
        val opened = openSheet()
        assertEquals(savings, opened.form.accountId)
        assertEquals(tips, opened.form.categoryId)
        assertEquals(design, opened.form.tipCategoryId)
    }

    @Test
    fun rememberedChoicesThatAreGoneOrDoNotFitAreIgnored() {
        // The euro account, the archived account and an unknown id are not offered; the expense category is not income.
        store.choices = PaymentChoices(accountId = id(3), categoryId = id(11), tipCategoryId = "gone")
        val opened = openSheet()
        assertNull(opened.form.accountId)
        assertNull(opened.form.categoryId)
        assertNull(opened.form.tipCategoryId)
    }

    @Test
    fun savingWithAProblemShowsItAndAsksNothing() {
        openSheet()
        viewModel.save()
        assertEquals(setOf(PaymentProblem.AccountMissing, PaymentProblem.CategoryMissing), ui().errors)
        assertFalse(ui().asking)
        assertTrue(writes().isEmpty())
    }

    @Test
    fun editingTheFormClearsTheProblemsAndTheLastError() {
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
        assertTrue(harness.quiet())
        assertTrue(writes().isEmpty())
    }

    @Test
    fun decliningTheQuestionSendsNothingAndKeepsTheForm() {
        filled()
        viewModel.save()
        viewModel.dismissAsk()
        assertFalse(ui().asking)
        assertEquals(checking, ui().form.accountId)
        assertTrue(harness.quiet())
        assertTrue(writes().isEmpty())
    }

    @Test
    fun changingTheFormWithdrawsTheQuestionSoOnlyWhatWasShownCanBeConfirmed() {
        filled()
        viewModel.save()
        assertTrue(ui().asking)
        viewModel.edit { it.copy(amount = "100.00") }
        assertFalse(ui().asking)
        viewModel.confirm()
        assertTrue(harness.quiet())
        assertTrue(writes().isEmpty())
    }

    @Test
    fun confirmingWithoutBeingAskedSendsNothing() {
        filled()
        viewModel.confirm()
        assertTrue(harness.quiet())
        assertTrue(writes().isEmpty())
    }

    @Test
    fun confirmingSendsOnePaymentWithItsKeyTheTokenAndTheVersionThePhoneHolds() {
        filled()
        sent()
        val write = writes().single()
        assertEquals(PaymentsPath, write.target)
        assertEquals(
            """{"amount":{"amount":45000,"currency":"USD"},"accountId":"$checking","categoryId":"$freelance","date":"2026-11-09","expectedReceivableVersion":1}""",
            write.body,
        )
        assertTrue(Regex("^pay-[A-Za-z0-9._:-]{8,120}$").matches(write.idempotencyKey.orEmpty()))
        assertEquals("Bearer tok", harness.tokens.last())
    }

    @Test
    fun moneyOverWhatIsOutstandingIsSentAsATipWithItsOwnCategory() {
        openSheet()
        viewModel.edit { it.copy(amount = "460.25", accountId = checking, categoryId = freelance, tipCategoryId = tips) }
        sent()
        assertEquals(
            """{"amount":{"amount":45000,"currency":"USD"},"accountId":"$checking","categoryId":"$freelance","date":"2026-11-09",""" +
                """"tip":{"amount":{"amount":1025,"currency":"USD"},"categoryId":"$tips"},"expectedReceivableVersion":1}""",
            writes().single().body,
        )
    }

    @Test
    fun aTipWithoutACategoryIsAProblemAndNothingIsAsked() {
        openSheet()
        viewModel.edit { it.copy(amount = "460.25", accountId = checking, categoryId = freelance) }
        viewModel.save()
        assertEquals(setOf(PaymentProblem.TipCategoryMissing), ui().errors)
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
        // The phone pulls, so the new income entry and the account balance show at once.
        harness.until { pulls.get() >= 1 }
    }

    @Test
    fun theTipCategoryIsRememberedOnlyWhenATipWasSent() {
        store.choices = PaymentChoices(tipCategoryId = design)
        openSheet()
        viewModel.edit { it.copy(accountId = checking, categoryId = freelance, tipCategoryId = tips) }
        sent()
        harness.until { viewModel.sheet.value == null }
        // No tip was needed, so the earlier tip choice stays as it was.
        assertEquals(PaymentChoices(accountId = checking, categoryId = freelance, tipCategoryId = design), store.choices)

        openSheet()
        viewModel.edit { it.copy(amount = "460.25", accountId = checking, categoryId = freelance, tipCategoryId = tips) }
        sent()
        harness.until { viewModel.sheet.value == null }
        assertEquals(tips, store.choices.tipCategoryId)
    }

    @Test
    fun aFailedSendKeepsTheFormAndATryAgainCarriesTheSameKey() {
        harness.route(PaymentsPath) { harness.json(500) }
        filled()
        sent()
        assertEquals(WriteError.Failed, ui().error)
        assertEquals(checking, ui().form.accountId)
        assertFalse(ui().saving)
        assertEquals(0, viewModel.reread.value)

        harness.route(PaymentsPath) { paid() }
        sent()
        harness.until { viewModel.sheet.value == null }
        val keys = writes().map { it.idempotencyKey }
        assertEquals(2, keys.size)
        assertEquals(keys[0], keys[1])
    }

    @Test
    fun aChangedPaymentGetsANewKey() {
        harness.route(PaymentsPath) { harness.json(500) }
        filled()
        sent()
        viewModel.edit { it.copy(amount = "400.00") }
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
    fun aServiceThatChangedMeanwhileShowsTheServersSentenceAndTheScreenReadsAgain() {
        harness.route(PaymentsPath) { problem(409, "This service changed. Reload and try again.") }
        filled()
        sent()
        assertEquals(WriteError.Rejected("This service changed. Reload and try again."), ui().error)
        assertEquals(1, viewModel.reread.value)
        harness.until { pulls.get() >= 1 }
    }

    @Test
    fun aRefusalThatIsNotStaleShowsTheSentenceWithoutReadingAgain() {
        harness.route(PaymentsPath) { problem(422, "Choose an income category.") }
        filled()
        sent()
        assertEquals(WriteError.Rejected("Choose an income category."), ui().error)
        assertEquals(0, viewModel.reread.value)
        assertEquals(0, pulls.get())
    }

    @Test
    fun aViewerIsToldTheyCannotChangeTheLedger() {
        harness.route(PaymentsPath) { harness.json(403) }
        filled()
        sent()
        assertEquals(WriteError.Forbidden, ui().error)
    }

    @Test
    fun aSecondConfirmWhileSavingSendsNothingMore() {
        harness.delayMillis = 400
        filled()
        viewModel.save()
        viewModel.confirm()
        assertTrue(ui().saving)
        viewModel.confirm()
        viewModel.save()
        harness.until { viewModel.sheet.value == null }
        assertEquals(1, writes().size)
    }

    @Test
    fun theSheetCannotBeClosedWhileSavingAndClosingForgetsItsKeys() {
        harness.route(PaymentsPath) { harness.json(500) }
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
        // Opened again, the same payment starts with a new key.
        filled()
        sent()
        assertNotEquals(first, writes().last().idempotencyKey)
    }
}
