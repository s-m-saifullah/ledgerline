package app.ledgerline.android.ui.clients

import app.ledgerline.android.mirror.MirrorStore
import app.ledgerline.android.mirror.Stamp
import app.ledgerline.android.mirror.account
import app.ledgerline.android.mirror.changes
import app.ledgerline.android.mirror.syncCurrency
import app.ledgerline.android.mirror.toRows
import app.ledgerline.android.online.ServiceWrites
import app.ledgerline.android.online.WriteError
import app.ledgerline.android.testing.OnlineHarness
import app.ledgerline.api.ApiJson
import app.ledgerline.api.Service
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

private const val Ledger = "ledger-a"
private const val ServicesPath = "/api/v1/ledgers/ledger-a/receivables"

/** The Log service sheet's logic (ADR 0050, slice 5): the real mirror and clients against a mock server, and the real write path. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LogServiceViewModelTest {
    private val harness = OnlineHarness()
    private lateinit var viewModel: LogServiceViewModel

    private val northwind = contact("Northwind Design", id = "northwind-design")
    private val logged = service("Logo refresh", 45_000, id = "logo-refresh")

    private fun seed(currencies: List<app.ledgerline.api.SyncCurrency> = emptyList()) = runBlocking {
        MirrorStore(harness.database).replaceAll(Ledger, changes(accounts = listOf(account(1, name = "Everyday checking")), currencies = currencies).toRows(Ledger), "c0", Stamp)
    }

    private fun created() = harness.json(201, ApiJson.encodeToString(Service.serializer(), logged))

    private fun problem(status: Int, detail: String) =
        harness.json(status, """{"type":"about:blank","title":"x","status":$status,"detail":"$detail","errors":[]}""")

    private fun model(origin: String? = null): LogServiceViewModel {
        val writer = if (origin == null) harness.writer() else harness.writer(origin)
        return LogServiceViewModel(harness.database.reads(), ServiceWrites(writer)).also { it.today = { "2026-11-11" } }
    }

    @Before
    fun open() {
        harness.open()
        seed()
        harness.route(ServicesPath) { created() }
        viewModel = model()
    }

    @After
    fun close() = harness.close()

    private fun openSheet(client: app.ledgerline.api.Contact = northwind): LogServiceUi {
        viewModel.open(client)
        harness.until { viewModel.sheet.value != null }
        return viewModel.sheet.value!!
    }

    private fun ui() = viewModel.sheet.value!!

    private fun filled() {
        openSheet()
        viewModel.edit { it.copy(description = "Logo refresh", amount = "450.00") }
    }

    private fun writes() = harness.recorded.filter { it.method == "POST" }

    private fun assertNothingWritten() {
        Thread.sleep(500)
        assertTrue(writes().isEmpty())
    }

    private fun sent() {
        viewModel.save()
        harness.until { viewModel.sheet.value?.saving != true }
    }

    @Test
    fun theSheetOpensForTheClientWithTodayAndNothingTyped() {
        val opened = openSheet()
        assertEquals(ServiceForm.forClient(ServiceClient("northwind-design", "Northwind Design"), "2026-11-11"), opened.form)
        assertTrue(opened.errors.isEmpty())
        assertFalse(opened.saving)
        assertNull(opened.error)
        assertNothingWritten()
    }

    @Test
    fun aLedgerWithOnlyTheBaseCurrencyOffersJustThat() {
        assertEquals(listOf("USD"), openSheet().currencies)
    }

    @Test
    fun theCurrenciesTheLedgerAddedFollowTheBaseCurrency() {
        seed(listOf(syncCurrency(1, "GBP"), syncCurrency(2, "EUR"), syncCurrency(3, "JPY", deletedAt = Stamp)))
        assertEquals(listOf("USD", "EUR", "GBP"), openSheet().currencies)
    }

    @Test
    fun theBaseCurrencyIsNeverListedTwice() {
        seed(listOf(syncCurrency(1, "USD"), syncCurrency(2, "EUR")))
        assertEquals(listOf("USD", "EUR"), openSheet().currencies)
    }

    @Test
    fun anArchivedClientOpensNothing() {
        viewModel.open(contact("Old Client", archived = true))
        Thread.sleep(500)
        assertNull(viewModel.sheet.value)
    }

    @Test
    fun aChangeIsKeptClearsTheProblemsAndTheLastError() {
        openSheet()
        viewModel.save()
        assertEquals(setOf(ServiceProblem.DescriptionMissing, ServiceProblem.AmountMissing), ui().errors)
        viewModel.edit { it.copy(description = "Logo") }
        assertTrue(ui().errors.isEmpty())
        assertNull(ui().error)
        assertEquals("Logo", ui().form.description)
    }

    @Test
    fun savingWithAProblemShowsItAndSendsNothing() {
        openSheet()
        viewModel.edit { it.copy(description = "Logo", amount = "abc") }
        viewModel.save()
        assertEquals(setOf(ServiceProblem.AmountInvalid), ui().errors)
        assertFalse(ui().saving)
        assertNothingWritten()
    }

    @Test
    fun typingSendsNothingUntilSave() {
        filled()
        viewModel.edit { it.copy(serviceTime = "09:30", dueDate = "2026-12-01") }
        assertTrue(harness.quiet())
        assertTrue(writes().isEmpty())
    }

    @Test
    fun savingSendsOneServiceWithItsKeyTheTokenAndNoQuestion() {
        filled()
        viewModel.save()
        // No question first: the write goes straight out.
        harness.until { viewModel.sheet.value == null }
        val write = writes().single()
        assertEquals(ServicesPath, write.target)
        assertEquals(
            """{"contactId":"northwind-design","description":"Logo refresh","serviceDate":"2026-11-11","amount":{"amount":45000,"currency":"USD"}}""",
            write.body,
        )
        assertTrue(Regex("^svc-[A-Za-z0-9._:-]{8,120}$").matches(write.idempotencyKey.orEmpty()))
        assertEquals("Bearer tok", harness.tokens.last())
    }

    @Test
    fun aTimeADueDateAndAnotherCurrencyAreSent() {
        seed(listOf(syncCurrency(1, "EUR")))
        openSheet()
        viewModel.edit { it.copy(description = " Print layout ", amount = "80", currency = "EUR", serviceTime = "09:30", dueDate = "2026-12-01") }
        sent()
        harness.until { viewModel.sheet.value == null }
        assertEquals(
            """{"contactId":"northwind-design","description":"Print layout","serviceDate":"2026-11-11","serviceTime":"09:30","dueDate":"2026-12-01","amount":{"amount":8000,"currency":"EUR"}}""",
            writes().single().body,
        )
    }

    @Test
    fun theHourlyHelperFillsTheAmountAndTheSavedServiceHasThatTotal() {
        openSheet()
        viewModel.edit { it.copy(hours = "3.5", hourlyRate = "40") }
        viewModel.edit { it.useTotal(rateLabel = { rate, _ -> "$$rate" }) }
        assertEquals("140.00", ui().form.amount)
        assertEquals("3.5 h at $4000/h", ui().form.description)
        sent()
        harness.until { viewModel.sheet.value == null }
        assertTrue(writes().single().body.contains(""""amount":{"amount":14000,"currency":"USD"}"""))
        assertFalse(writes().single().body.contains("hours"))
    }

    @Test
    fun aSavedServiceClosesTheSheetAndTellsTheScreenToReadAgain() {
        filled()
        assertEquals(0, viewModel.reread.value)
        sent()
        harness.until { viewModel.sheet.value == null }
        assertEquals(1, viewModel.reread.value)
    }

    @Test
    fun aFailedSendKeepsTheFormAndATryAgainCarriesTheSameKey() {
        harness.route(ServicesPath) { harness.json(500) }
        filled()
        sent()
        assertEquals(WriteError.Failed, ui().error)
        assertEquals("Logo refresh", ui().form.description)
        assertFalse(ui().saving)
        assertEquals(0, viewModel.reread.value)

        harness.route(ServicesPath) { created() }
        sent()
        harness.until { viewModel.sheet.value == null }
        val keys = writes().map { it.idempotencyKey }
        assertEquals(2, keys.size)
        assertEquals(keys[0], keys[1])
    }

    @Test
    fun aChangedServiceGetsANewKey() {
        harness.route(ServicesPath) { harness.json(500) }
        filled()
        sent()
        viewModel.edit { it.copy(amount = "400.00") }
        sent()
        val keys = writes().map { it.idempotencyKey }
        assertEquals(2, keys.size)
        assertNotEquals(keys[0], keys[1])
    }

    @Test
    fun anOfflinePhoneKeepsWhatWasTypedAndSaysSo() {
        viewModel = model(origin = harness.closedOrigin())
        filled()
        sent()
        assertEquals(WriteError.Offline, ui().error)
        assertEquals("450.00", ui().form.amount)
        assertFalse(ui().saving)
        assertEquals(0, viewModel.reread.value)
    }

    @Test
    fun aViewerIsToldTheyCannotChangeTheLedger() {
        harness.route(ServicesPath) { harness.json(403) }
        filled()
        sent()
        assertEquals(WriteError.Forbidden, ui().error)
        assertEquals(0, viewModel.reread.value)
    }

    @Test
    fun aClientThatIsGoneOrChangedShowsTheServersSentenceAndTheScreenReadsAgain() {
        harness.route(ServicesPath) { problem(404, "This client no longer exists.") }
        filled()
        sent()
        assertEquals(WriteError.Rejected("This client no longer exists."), ui().error)
        assertEquals(1, viewModel.reread.value)
    }

    @Test
    fun aConflictShowsTheServersSentenceAndTheScreenReadsAgain() {
        harness.route(ServicesPath) { problem(409, "This client was archived.") }
        filled()
        sent()
        assertEquals(WriteError.Rejected("This client was archived."), ui().error)
        assertEquals(1, viewModel.reread.value)
    }

    @Test
    fun aRefusalThatIsNotStaleShowsTheSentenceWithoutReadingAgain() {
        harness.route(ServicesPath) { problem(422, "That currency is not set up for this ledger.") }
        filled()
        sent()
        assertEquals(WriteError.Rejected("That currency is not set up for this ledger."), ui().error)
        assertEquals(0, viewModel.reread.value)
    }

    @Test
    fun aSecondSaveWhileSavingSendsNothingMoreAndEditingIsIgnored() {
        harness.delayMillis = 400
        filled()
        viewModel.save()
        assertTrue(ui().saving)
        viewModel.save()
        viewModel.edit { it.copy(description = "Something else") }
        assertEquals("Logo refresh", ui().form.description)
        harness.until { viewModel.sheet.value == null }
        assertEquals(1, writes().size)
    }

    @Test
    fun theSheetCannotBeClosedWhileSavingAndClosingForgetsItsKeys() {
        harness.route(ServicesPath) { harness.json(500) }
        filled()
        sent()
        val first = writes().single().idempotencyKey

        harness.delayMillis = 300
        viewModel.save()
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

    @Test
    fun aSheetOpenedAgainStartsEmptyNotWithWhatWasTypedBefore() {
        filled()
        viewModel.close()
        val again = openSheet()
        assertEquals("", again.form.description)
        assertEquals("", again.form.amount)
    }

    // ---- editing an existing service (ADR 0050, slice 5b)

    private val saved = service("Logo refresh", 45_000, received = 10_000, date = "2026-10-02", time = "14:30", due = "2026-10-20", id = "logo-refresh")
    private val EditPath = "/api/v1/ledgers/ledger-a/receivables/logo-refresh"

    private fun edited() = harness.json(200, ApiJson.encodeToString(Service.serializer(), saved))

    private fun openEdit(service: Service = saved, client: app.ledgerline.api.Contact = northwind): LogServiceUi {
        viewModel.openEdit(client, service)
        harness.until { viewModel.sheet.value != null }
        return viewModel.sheet.value!!
    }

    private fun patches() = harness.recorded.filter { it.method == "PATCH" }

    private fun savedEdit() {
        viewModel.save()
        harness.until { viewModel.sheet.value?.saving != true }
    }

    @Test
    fun theEditSheetOpensWithWhatTheServiceHasAndNothingIsSent() {
        harness.route(EditPath) { edited() }
        val opened = openEdit()
        assertEquals(ServiceForm.forEditing(ServiceClient("northwind-design", "Northwind Design"), saved), opened.form)
        assertEquals(listOf("USD"), opened.currencies)
        assertNothingWritten()
        assertTrue(patches().isEmpty())
    }

    @Test
    fun aWrittenOffServiceCannotBeEdited() {
        viewModel.openEdit(northwind, service("Menu photos", 8_000, received = 5_000, writtenOff = 3_000, id = "waived"))
        Thread.sleep(500)
        assertNull(viewModel.sheet.value)
    }

    @Test
    fun savingAnEditSendsOnePatchWithTheVersionAndNoQuestion() {
        harness.route(EditPath) { edited() }
        openEdit()
        viewModel.edit { it.copy(description = "Logo refresh v2", amount = "500.00", serviceTime = null) }
        viewModel.save()
        harness.until { viewModel.sheet.value == null }
        val write = patches().single()
        assertEquals(EditPath, write.target)
        assertEquals(
            """{"contactId":"northwind-design","description":"Logo refresh v2","serviceDate":"2026-10-02","serviceTime":null,"dueDate":"2026-10-20","amount":{"amount":50000,"currency":"USD"},"expectedVersion":1}""",
            write.body,
        )
        assertTrue(Regex("^svc-[A-Za-z0-9._:-]{8,120}$").matches(write.idempotencyKey.orEmpty()))
        assertTrue(writes().isEmpty())
    }

    @Test
    fun aSavedEditClosesTheSheetAndTellsTheScreenToReadAgain() {
        harness.route(EditPath) { edited() }
        openEdit()
        viewModel.edit { it.copy(description = "Logo refresh v2") }
        savedEdit()
        harness.until { viewModel.sheet.value == null }
        assertEquals(1, viewModel.reread.value)
    }

    @Test
    fun anAmountBelowWhatWasReceivedIsSaidAndNothingIsSent() {
        harness.route(EditPath) { edited() }
        openEdit()
        viewModel.edit { it.copy(amount = "50.00") }
        viewModel.save()
        assertEquals(setOf(ServiceProblem.AmountBelowReceived), ui().errors)
        assertFalse(ui().saving)
        Thread.sleep(500)
        assertTrue(patches().isEmpty())
    }

    @Test
    fun aFailedEditKeepsTheFormAndATryAgainCarriesTheSameKey() {
        harness.route(EditPath) { harness.json(500) }
        openEdit()
        viewModel.edit { it.copy(description = "Logo refresh v2") }
        savedEdit()
        assertEquals(WriteError.Failed, ui().error)
        assertEquals("Logo refresh v2", ui().form.description)
        harness.route(EditPath) { edited() }
        savedEdit()
        harness.until { viewModel.sheet.value == null }
        val keys = patches().map { it.idempotencyKey }
        assertEquals(2, keys.size)
        assertEquals(keys[0], keys[1])
    }

    @Test
    fun aChangedEditGetsANewKey() {
        harness.route(EditPath) { harness.json(500) }
        openEdit()
        viewModel.edit { it.copy(description = "One") }
        savedEdit()
        viewModel.edit { it.copy(description = "Two") }
        savedEdit()
        val keys = patches().map { it.idempotencyKey }
        assertEquals(2, keys.size)
        assertNotEquals(keys[0], keys[1])
    }

    @Test
    fun anOfflinePhoneKeepsTheEditAndSaysSo() {
        viewModel = model(origin = harness.closedOrigin())
        openEdit()
        viewModel.edit { it.copy(description = "Logo refresh v2") }
        savedEdit()
        assertEquals(WriteError.Offline, ui().error)
        assertEquals("Logo refresh v2", ui().form.description)
        assertEquals(0, viewModel.reread.value)
    }

    @Test
    fun aViewerIsToldTheyCannotChangeAServiceEither() {
        harness.route(EditPath) { harness.json(403) }
        openEdit()
        savedEdit()
        assertEquals(WriteError.Forbidden, ui().error)
        assertEquals(0, viewModel.reread.value)
    }

    @Test
    fun aServiceThatChangedMeanwhileShowsTheServersSentenceAndTheScreenReadsAgain() {
        harness.route(EditPath) { problem(409, "This service changed. Reload and try again.") }
        openEdit()
        savedEdit()
        assertEquals(WriteError.Rejected("This service changed. Reload and try again."), ui().error)
        assertEquals(1, viewModel.reread.value)
        // The sheet stays so the sentence can be read; its version is old, so it is closed and opened again.
        assertTrue(viewModel.sheet.value != null)
    }

    @Test
    fun aServiceThatIsGoneShowsTheServersSentenceAndTheScreenReadsAgain() {
        harness.route(EditPath) { problem(404, "Service not found.") }
        openEdit()
        savedEdit()
        assertEquals(WriteError.Rejected("Service not found."), ui().error)
        assertEquals(1, viewModel.reread.value)
    }

    @Test
    fun anEditRefusalThatIsNotStaleShowsTheSentenceWithoutReadingAgain() {
        harness.route(EditPath) { problem(422, "Choose an active client.") }
        openEdit()
        savedEdit()
        assertEquals(WriteError.Rejected("Choose an active client."), ui().error)
        assertEquals(0, viewModel.reread.value)
    }

    @Test
    fun aSecondSaveWhileAnEditIsBeingSentSendsNothingMore() {
        harness.delayMillis = 400
        harness.route(EditPath) { edited() }
        openEdit()
        viewModel.edit { it.copy(description = "Logo refresh v2") }
        viewModel.save()
        assertTrue(ui().saving)
        viewModel.save()
        harness.until { viewModel.sheet.value == null }
        assertEquals(1, patches().size)
    }

    @Test
    fun aSheetOpenedToLogANewServiceAfterAnEditStartsEmptyAndPostsAgain() {
        harness.route(EditPath) { edited() }
        openEdit()
        viewModel.close()
        val fresh = openSheet()
        assertEquals("", fresh.form.description)
        assertNull(fresh.form.editing)
        viewModel.edit { it.copy(description = "New", amount = "10") }
        viewModel.save()
        harness.until { viewModel.sheet.value == null }
        assertEquals(1, writes().size)
        assertTrue(patches().isEmpty())
    }

    @Test
    fun anEditSheetOpenedAfterANewOneStartsWithTheServicesValues() {
        harness.route(EditPath) { edited() }
        openSheet()
        viewModel.edit { it.copy(description = "Half typed") }
        viewModel.close()
        assertEquals("Logo refresh", openEdit().form.description)
    }
}

