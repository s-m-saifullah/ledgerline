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
        viewModel.edit { it.useTotal { rate, _ -> "$$rate" } }
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
}
