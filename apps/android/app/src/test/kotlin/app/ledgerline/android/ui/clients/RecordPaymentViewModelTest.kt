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
import app.ledgerline.android.online.RateReads
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
                    account(6, name = "Pound account", currency = "GBP"),
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
        val reader = if (origin == null) harness.reader() else harness.reader(origin)
        return RecordPaymentViewModel(database.reads(), PaymentWrites(writer), sync, store, RateReads(reader)).also { it.today = { "2026-11-09" } }
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

    /** A write happens on another thread, so "nothing was sent" is only true after a pause long enough for one to arrive. */
    private fun assertNothingWritten() {
        Thread.sleep(500)
        assertTrue(writes().isEmpty())
    }

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
        // A dollar service can go into any currency (one side is the base currency); archived and client balance accounts are left out.
        assertEquals(listOf("Euro account", "Everyday checking", "Pound account", "Savings"), opened.accounts.map { it.label })
        // Income categories only, a subcategory under its main one, the archived one left out.
        assertEquals(listOf("Freelance", "Freelance › Design work", "Tips"), opened.categories.map { it.label })
        assertFalse(opened.noIncomeCategory)
        assertFalse(opened.saving)
        assertFalse(opened.asking)
        assertNull(opened.error)
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
        // The archived account and an unknown id are not offered; the expense category is not income.
        store.choices = PaymentChoices(accountId = id(4), categoryId = id(11), tipCategoryId = "gone")
        val opened = openSheet()
        assertNull(opened.form.accountId)
        assertNull(opened.form.categoryId)
        assertNull(opened.form.tipCategoryId)
    }

    private val eurService = service("Print layout", 12_000, id = "print-layout", currency = "EUR")

    @Test
    fun aServiceInEurosCanGoIntoAnyOpenAccountPoundsIncluded() {
        val opened = openSheet(eurService)
        assertEquals(listOf("Euro account", "Everyday checking", "Pound account", "Savings"), opened.accounts.map { it.label })
    }

    @Test
    fun aRememberedAccountComesBackWithItsCurrency() {
        store.choices = PaymentChoices(accountId = id(3))
        assertEquals("EUR", openSheet().form.accountCurrency)
        viewModel.close()
        store.choices = PaymentChoices(accountId = checking)
        assertEquals("USD", openSheet().form.accountCurrency)
        viewModel.close()
        store.choices = PaymentChoices()
        assertNull(openSheet().form.accountCurrency)
    }

    @Test
    fun aPaymentIntoAnEuroAccountSendsWhatArrivedAndATipInEurosWithoutARate() {
        openSheet()
        viewModel.edit { it.withAccount(id(3), "EUR").copy(categoryId = freelance, received = "410.00", tipAmount = "5.50", tipCategoryId = tips) }
        sent()
        harness.until { viewModel.sheet.value == null }
        assertEquals(
            """{"amount":{"amount":45000,"currency":"USD"},"receivedAmount":{"amount":41000,"currency":"EUR"},"accountId":"${id(3)}","categoryId":"$freelance","date":"2026-11-09",""" +
                """"tip":{"amount":{"amount":550,"currency":"EUR"},"categoryId":"$tips"},"expectedReceivableVersion":1}""",
            writes().single().body,
        )
    }

    @Test
    fun anAmountThatArrivedIsRequiredBeforeAnythingIsAsked() {
        openSheet()
        viewModel.edit { it.withAccount(id(3), "EUR").copy(categoryId = freelance) }
        viewModel.save()
        assertEquals(setOf(PaymentProblem.ReceivedMissing), ui().errors)
        assertFalse(ui().asking)
        assertNothingWritten()
    }

    @Test
    fun aBadTipIsSaidAndNothingIsAsked() {
        openSheet()
        viewModel.edit { it.withAccount(id(3), "EUR").copy(categoryId = freelance, received = "410.00", tipAmount = "x") }
        viewModel.save()
        assertEquals(setOf(PaymentProblem.TipInvalid), ui().errors)
        assertFalse(ui().asking)
    }

    @Test
    fun theTipCategoryIsRememberedOnlyWhenATipWasSentAcrossCurrenciesToo() {
        openSheet()
        viewModel.edit { it.withAccount(id(3), "EUR").copy(categoryId = freelance, received = "410.00", tipAmount = "5.50", tipCategoryId = tips) }
        sent()
        harness.until { viewModel.sheet.value == null }
        assertEquals(PaymentChoices(accountId = id(3), categoryId = freelance, tipCategoryId = tips), store.choices)
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

    // ---- neither side the base currency (ADR 0050, slice 4b-2)

    private val pound = id(6)
    private val dollars = checking
    private val euros = id(3)

    private fun routeRates(byDate: Map<String, String?>, status: Int = 200) = harness.routeRates(byDate, status)

    private fun lookups() = harness.rateLookups()

    private fun stored() = ui().form.cross?.stored

    private fun aPoundPayment() {
        harness.route("/api/v1/ledgers/ledger-a/receivables/print-layout/payments") { paid() }
        openSheet(eurService)
        viewModel.edit { it.withAccount(pound, "GBP").copy(categoryId = freelance, received = "130.00") }
    }

    @Test
    fun anAccountWhereNeitherSideIsDollarsLooksUpTheStoredRateForItsCurrencyOnThePaymentsDate() {
        routeRates(mapOf("2026-11-09" to "1.2658227848"))
        aPoundPayment()
        harness.until { stored() is StoredRate.Found }
        assertEquals(listOf("/api/v1/ledgers/ledger-a/exchange-rates/lookup?code=GBP&date=2026-11-09"), lookups())
        assertEquals(StoredRate.Found("1.2658227848", "2026-11-07"), stored())
        assertEquals("1.2658227848", ui().form.cross!!.rateInUse)
    }

    @Test
    fun noLookUpIsMadeForAccountsInTheServicesCurrencyOrDollars() {
        routeRates(mapOf("2026-11-09" to "1.2658227848"))
        openSheet(eurService)
        viewModel.edit { it.withAccount(euros, "EUR") }
        viewModel.edit { it.withAccount(dollars, "USD") }
        assertEquals(StoredRate.Looking, ui().form.cross?.stored ?: StoredRate.Looking)
        assertTrue(harness.quiet())
        assertTrue(lookups().isEmpty())
    }

    @Test
    fun aRememberedPoundAccountLooksUpTheRateAsTheSheetOpens() {
        routeRates(mapOf("2026-11-09" to "1.2658227848"))
        store.choices = PaymentChoices(accountId = pound)
        openSheet(eurService)
        harness.until { stored() is StoredRate.Found }
        assertEquals(1, lookups().size)
    }

    @Test
    fun changingTheDateAsksAgainForThatDateAndTheOldAnswerIsNotUsedMeanwhile() {
        routeRates(mapOf("2026-11-09" to "1.2658227848", "2026-11-03" to "1.2000000000"))
        aPoundPayment()
        harness.until { stored() is StoredRate.Found }
        viewModel.edit { it.copy(date = "2026-11-03") }
        assertEquals(StoredRate.Looking, stored())
        harness.until { (stored() as? StoredRate.Found)?.rate == "1.2000000000" }
        assertEquals(2, lookups().size)
        assertTrue(lookups().last().endsWith("date=2026-11-03"))
    }

    @Test
    fun anAnswerThatArrivesLateForAnotherDateIsDropped() {
        val release = java.util.concurrent.CountDownLatch(1)
        harness.route(RateLookupPath) { target ->
            val date = Regex("date=([^&]+)").find(target)!!.groupValues[1]
            if (date == "2026-11-09") release.await(5, java.util.concurrent.TimeUnit.SECONDS)
            rateReply(harness, "GBP", date, if (date == "2026-11-09") "1.1111111111" else "1.2000000000")
        }
        aPoundPayment()
        viewModel.edit { it.copy(date = "2026-11-03") }
        harness.until { (stored() as? StoredRate.Found)?.rate == "1.2000000000" }
        release.countDown()
        Thread.sleep(500)
        assertEquals("1.2000000000", (stored() as StoredRate.Found).rate)
    }

    @Test
    fun movingToAnAccountThatNeedsNoRateStopsAskingAndTheOldAnswerIsNotUsed() {
        routeRates(mapOf("2026-11-09" to "1.2658227848"))
        aPoundPayment()
        harness.until { stored() is StoredRate.Found }
        viewModel.edit { it.withAccount(dollars, "USD") }
        assertNull(ui().form.rateKey)
        assertNull(ui().form.cross!!.rateInUse)
    }

    @Test
    fun aDateWithNoRateStoredBlocksSavingUntilOneIsTyped() {
        routeRates(mapOf("2026-11-09" to null))
        aPoundPayment()
        harness.until { stored() == StoredRate.Missing }
        viewModel.save()
        assertEquals(setOf(PaymentProblem.RateMissing), ui().errors)
        assertFalse(ui().asking)
        assertNothingWritten()
        viewModel.edit { it.copy(rateTyped = "122.5") }
        sent()
        harness.until { viewModel.sheet.value == null }
        assertTrue(writes().single().body.contains(""""fxRate":"0.0081632653""""))
    }

    @Test
    fun aStoredRateIsNotSentWithThePayment() {
        routeRates(mapOf("2026-11-09" to "1.2658227848"))
        aPoundPayment()
        harness.until { stored() is StoredRate.Found }
        sent()
        harness.until { viewModel.sheet.value == null }
        assertEquals(
            """{"amount":{"amount":12000,"currency":"EUR"},"receivedAmount":{"amount":13000,"currency":"GBP"},"accountId":"$pound","categoryId":"$freelance","date":"2026-11-09","expectedReceivableVersion":1}""",
            writes().single().body,
        )
    }

    @Test
    fun aTypedRateThatCannotBeStoredIsRefusedAndNothingIsAsked() {
        routeRates(mapOf("2026-11-09" to "1.2658227848"))
        aPoundPayment()
        harness.until { stored() is StoredRate.Found }
        viewModel.edit { it.copy(rateTyped = "abc") }
        viewModel.save()
        assertEquals(setOf(PaymentProblem.RateInvalid), ui().errors)
        assertFalse(ui().asking)
        assertNothingWritten()
    }

    @Test
    fun aLookUpThatFailedDoesNotBlockSavingTheServerDecides() {
        routeRates(mapOf(), status = 500)
        aPoundPayment()
        harness.until { stored() == StoredRate.Unavailable }
        viewModel.save()
        assertTrue(ui().asking)
        viewModel.confirm()
        harness.until { viewModel.sheet.value == null }
        assertFalse(writes().single().body.contains("fxRate"))
    }

    @Test
    fun savingAfterAFailedLookUpTriesItAgain() {
        routeRates(mapOf(), status = 500)
        aPoundPayment()
        harness.until { stored() == StoredRate.Unavailable }
        routeRates(mapOf("2026-11-09" to "1.2658227848"))
        viewModel.save()
        harness.until { stored() is StoredRate.Found }
        assertEquals(2, lookups().size)
    }

    @Test
    fun anAnswerThatMakesTheRateMissingWithdrawsAQuestionAlreadyBeingAsked() {
        val release = java.util.concurrent.CountDownLatch(1)
        harness.route(RateLookupPath) { _ ->
            release.await(5, java.util.concurrent.TimeUnit.SECONDS)
            rateReply(harness, "GBP", "2026-11-09", null)
        }
        aPoundPayment()
        viewModel.save()
        assertTrue(ui().asking)
        release.countDown()
        harness.until { stored() == StoredRate.Missing }
        harness.until { !ui().asking }
        assertNothingWritten()
    }

    @Test
    fun anAnswerThatKeepsTheRateFineLeavesAQuestionBeingAsked() {
        val release = java.util.concurrent.CountDownLatch(1)
        harness.route(RateLookupPath) { _ ->
            release.await(5, java.util.concurrent.TimeUnit.SECONDS)
            rateReply(harness, "GBP", "2026-11-09", "1.2658227848")
        }
        aPoundPayment()
        viewModel.save()
        release.countDown()
        harness.until { stored() is StoredRate.Found }
        assertTrue(ui().asking)
    }

    @Test
    fun theRateTypedForOneAccountIsDroppedWhenAnotherCurrencyIsChosen() {
        routeRates(mapOf("2026-11-09" to "1.2658227848"))
        aPoundPayment()
        viewModel.edit { it.copy(rateTyped = "122.5") }
        viewModel.edit { it.withAccount(euros, "EUR") }
        assertEquals("", ui().form.rateTyped)
    }
}
