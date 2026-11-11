package app.ledgerline.android.ui.loans

import app.ledgerline.android.mirror.MirrorStore
import app.ledgerline.android.mirror.PullSource
import app.ledgerline.android.mirror.Stamp
import app.ledgerline.android.mirror.SyncEngine
import app.ledgerline.android.mirror.SyncLock
import app.ledgerline.android.mirror.account
import app.ledgerline.android.mirror.changes
import app.ledgerline.android.mirror.id
import app.ledgerline.android.mirror.page
import app.ledgerline.android.mirror.toRows
import app.ledgerline.android.online.LoanWrites
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
import app.ledgerline.android.ui.clients.loan
import app.ledgerline.api.ApiJson
import app.ledgerline.api.LoanResult
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
private const val Person = "sam"
private const val Base = "/api/v1/ledgers/ledger-a/contacts/sam/loans"

/** One route for all three moves, so a test that changes the answer replaces it (the first route that matches is used). */
private const val Moves = "$Base/(lend|borrow|repay)"

/** The Lend, Borrow and Repay sheet's logic (ADR 0050, slice 6): the real mirror and clients against a mock server, and the real write path. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class RecordLoanViewModelTest {
    private val harness = OnlineHarness()
    private val store = FakePaymentChoicesStore()
    private val pulls = AtomicInteger()
    private lateinit var viewModel: RecordLoanViewModel

    private val sam = LoanWho(Person, "Sam Rivera")

    // Accounts: 1 and 2 are dollar accounts to offer, 3 is in euros, 4 is archived, 5 is a balance kept for a person.
    private val checking = id(1)
    private val savings = id(2)
    private val euro = id(3)

    private fun seed() = runBlocking {
        MirrorStore(harness.database).replaceAll(
            Ledger,
            changes(
                accounts = listOf(
                    account(1, name = "Everyday checking"), account(2, name = "Savings"), account(3, name = "Euro account", currency = "EUR"),
                    account(4, name = "Old account", archived = true), account(5, name = "Sam balance", contactId = Person),
                ),
            ).toRows(Ledger),
            "c0", Stamp,
        )
    }

    private fun moved() = harness.json(201, ApiJson.encodeToString(LoanResult.serializer(), LoanResult(loan("USD", 5_000), "transfer-1", null)))

    private fun problem(status: Int, detail: String) =
        harness.json(status, """{"type":"about:blank","title":"x","status":$status,"detail":"$detail","errors":[]}""")

    private fun model(origin: String? = null): RecordLoanViewModel {
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
        return RecordLoanViewModel(database.reads(), LoanWrites(writer), sync, store).also { it.today = { "2026-11-11" } }
    }

    @Before
    fun open() {
        harness.open()
        seed()
        harness.route(Moves) { moved() }
        viewModel = model()
    }

    @After
    fun close() = harness.close()

    private val theyOweUsd = loan("USD", 10_000)
    private val theyOweEur = loan("EUR", 4_000)
    private val settledGbp = loan("GBP", 0)

    private fun openSheet(kind: LoanKind = LoanKind.Lend, loans: List<app.ledgerline.api.LoanBalance> = emptyList()): LoanUi {
        viewModel.open(sam, loans, kind)
        harness.until { viewModel.sheet.value != null }
        return viewModel.sheet.value!!
    }

    private fun ui() = viewModel.sheet.value!!

    private fun lendFifty() {
        openSheet()
        viewModel.edit { it.copy(amount = "50.00", accountId = checking) }
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
    fun theSheetOpensEmptyOnTodayWithOnlyTheOwnersOpenAccounts() {
        val opened = openSheet()
        assertEquals("", opened.form.amount)
        assertEquals("2026-11-11", opened.form.date)
        assertEquals(LoanKind.Lend, opened.form.kind)
        assertEquals(sam, opened.form.who)
        // Archived accounts and the balance kept for a person are not offered.
        assertEquals(listOf("Euro account", "Everyday checking", "Savings"), opened.form.accounts.map { it.name })
        assertFalse(opened.saving)
        assertFalse(opened.asking)
        assertNull(opened.error)
        assertTrue(opened.errors.isEmpty())
    }

    @Test
    fun theFormGetsTheOpenLoansWithTheirSignsAndLeavesSettledOnesOut() {
        val opened = openSheet(LoanKind.Repay, listOf(theyOweUsd, loan("EUR", -4_000), settledGbp))
        assertEquals(listOf(OpenLoan("USD", 10_000), OpenLoan("EUR", -4_000)), opened.form.open)
    }

    @Test
    fun aRepaymentDoesNotOpenWhenNothingIsOpen() {
        viewModel.open(sam, listOf(settledGbp), LoanKind.Repay)
        viewModel.open(sam, emptyList(), LoanKind.Repay)
        assertNothingWritten()
        assertNull(viewModel.sheet.value)
    }

    @Test
    fun lendingAndBorrowingOpenWithNothingOpenOrEvenNoLoanYet() {
        assertEquals(LoanKind.Lend, openSheet(LoanKind.Lend, emptyList()).form.kind)
        viewModel.close()
        assertEquals(LoanKind.Borrow, openSheet(LoanKind.Borrow, listOf(settledGbp)).form.kind)
    }

    @Test
    fun theAccountOfTheLastMoveIsChosenAgainWhenItIsStillOffered() {
        store.choices = PaymentChoices(loanAccountId = savings)
        assertEquals(savings, openSheet().form.accountId)
        assertEquals("Savings", ui().form.account!!.name)
    }

    @Test
    fun aRememberedAccountThatIsGoneOrDoesNotFitIsIgnored() {
        store.choices = PaymentChoices(loanAccountId = id(4))
        assertNull(openSheet().form.accountId)
        viewModel.close()
        store.choices = PaymentChoices(loanAccountId = "gone")
        assertNull(openSheet().form.accountId)
        viewModel.close()
        // A dollar loan is repaid from a dollar account: the euro account that was remembered does not fit.
        store.choices = PaymentChoices(loanAccountId = euro)
        val repay = openSheet(LoanKind.Repay, listOf(theyOweUsd))
        assertNull(repay.form.accountId)
        assertEquals("Everyday checking", repay.form.account!!.name)
    }

    @Test
    fun theAccountOfAPaymentIsNotTheAccountOfALoan() {
        store.choices = PaymentChoices(accountId = savings, categoryId = "x", tipCategoryId = "y")
        assertNull(openSheet().form.accountId)
    }

    @Test
    fun savingWithAProblemShowsItAndAsksNothing() {
        openSheet()
        viewModel.save()
        assertEquals(setOf(LoanProblem.AmountMissing), ui().errors)
        assertFalse(ui().asking)
        assertTrue(writes().isEmpty())
    }

    @Test
    fun repayingMoreThanIsOpenIsSaidAndNothingIsAsked() {
        openSheet(LoanKind.Repay, listOf(theyOweUsd))
        viewModel.edit { it.copy(amount = "100.01") }
        viewModel.save()
        assertEquals(setOf(LoanProblem.MoreThanOpen), ui().errors)
        assertFalse(ui().asking)
        assertNothingWritten()
    }

    @Test
    fun editingTheFormClearsTheProblemsAndTheLastError() {
        openSheet()
        viewModel.save()
        viewModel.edit { it.copy(amount = "5") }
        assertTrue(ui().errors.isEmpty())
        assertNull(ui().error)
    }

    @Test
    fun aValidFormAsksFirstAndSendsNothingUntilItIsConfirmed() {
        lendFifty()
        viewModel.save()
        assertTrue(ui().asking)
        assertTrue(ui().errors.isEmpty())
        assertTrue(harness.quiet())
        assertTrue(writes().isEmpty())
    }

    @Test
    fun decliningTheQuestionSendsNothingAndKeepsTheForm() {
        lendFifty()
        viewModel.save()
        viewModel.dismissAsk()
        assertFalse(ui().asking)
        assertEquals("50.00", ui().form.amount)
        assertTrue(harness.quiet())
        assertTrue(writes().isEmpty())
    }

    @Test
    fun changingTheFormWithdrawsTheQuestionSoOnlyWhatWasShownCanBeConfirmed() {
        lendFifty()
        viewModel.save()
        assertTrue(ui().asking)
        viewModel.edit { it.copy(amount = "500.00") }
        assertFalse(ui().asking)
        viewModel.confirm()
        assertTrue(harness.quiet())
        assertTrue(writes().isEmpty())
    }

    @Test
    fun confirmingWithoutBeingAskedSendsNothing() {
        lendFifty()
        viewModel.confirm()
        assertTrue(harness.quiet())
        assertTrue(writes().isEmpty())
    }

    @Test
    fun aLendIsOneWriteToTheLendRouteWithItsKeyTheTokenAndTheExactBody() {
        lendFifty()
        sent()
        val write = writes().single()
        assertEquals("$Base/lend", write.target)
        assertEquals(
            """{"accountId":"$checking","amount":{"amount":5000,"currency":"USD"},"date":"2026-11-11","time":null,"note":null}""",
            write.body,
        )
        assertTrue(Regex("^loan-[A-Za-z0-9._:-]{8,120}$").matches(write.idempotencyKey.orEmpty()))
        assertEquals("Bearer tok", harness.tokens.last())
    }

    @Test
    fun aLendIntoAnEuroAccountIsInEurosWithTheNote() {
        openSheet()
        viewModel.edit { it.copy(amount = "12.50", accountId = euro, note = " Train ") }
        sent()
        assertEquals(
            """{"accountId":"$euro","amount":{"amount":1250,"currency":"EUR"},"date":"2026-11-11","time":null,"note":"Train"}""",
            writes().single().body,
        )
    }

    @Test
    fun aBorrowGoesToTheBorrowRoute() {
        openSheet(LoanKind.Borrow)
        viewModel.edit { it.copy(amount = "20", accountId = savings) }
        sent()
        assertEquals("$Base/borrow", writes().single().target)
        assertEquals(
            """{"accountId":"$savings","amount":{"amount":2000,"currency":"USD"},"date":"2026-11-11","time":null,"note":null}""",
            writes().single().body,
        )
    }

    @Test
    fun aRepaymentGoesToTheRepayRouteInTheLoansCurrency() {
        openSheet(LoanKind.Repay, listOf(theyOweUsd, theyOweEur))
        viewModel.edit { it.withCurrency("EUR").copy(amount = "15.00") }
        assertEquals("Euro account", ui().form.account!!.name)
        sent()
        assertEquals("$Base/repay", writes().single().target)
        assertEquals(
            """{"accountId":"$euro","amount":{"amount":1500,"currency":"EUR"},"date":"2026-11-11","time":null,"note":null}""",
            writes().single().body,
        )
    }

    @Test
    fun aMoveThatWentThroughClosesTheSheetRemembersTheAccountAndTellsTheScreenToReadAgain() {
        lendFifty()
        assertEquals(0, viewModel.reread.value)
        sent()
        harness.until { viewModel.sheet.value == null }
        assertEquals(1, viewModel.reread.value)
        assertEquals(checking, store.choices.loanAccountId)
        // The phone pulls, so the account's balance and the person's moves show at once.
        harness.until { pulls.get() >= 1 }
    }

    @Test
    fun rememberingTheAccountLeavesWhatPaymentsRememberAsItWas() {
        store.choices = PaymentChoices(accountId = "pa", categoryId = "pc", tipCategoryId = "pt")
        lendFifty()
        sent()
        harness.until { viewModel.sheet.value == null }
        assertEquals(PaymentChoices(accountId = "pa", categoryId = "pc", tipCategoryId = "pt", loanAccountId = checking), store.choices)
    }

    @Test
    fun theAccountUsedIsRememberedEvenWhenItWasOnlyTheFirstOffered() {
        openSheet()
        viewModel.edit { it.copy(amount = "5") }
        sent()
        harness.until { viewModel.sheet.value == null }
        assertEquals(euro, store.choices.loanAccountId)
    }

    @Test
    fun aFailedSendKeepsTheFormAndATryAgainCarriesTheSameKey() {
        harness.route(Moves) { harness.json(500) }
        lendFifty()
        sent()
        assertEquals(WriteError.Failed, ui().error)
        assertEquals("50.00", ui().form.amount)
        assertFalse(ui().saving)
        assertEquals(0, viewModel.reread.value)

        harness.route(Moves) { moved() }
        sent()
        harness.until { viewModel.sheet.value == null }
        val keys = writes().map { it.idempotencyKey }
        assertEquals(2, keys.size)
        assertEquals(keys[0], keys[1])
    }

    @Test
    fun aChangedMoveGetsANewKey() {
        harness.route(Moves) { harness.json(500) }
        lendFifty()
        sent()
        viewModel.edit { it.copy(amount = "40.00") }
        sent()
        val keys = writes().map { it.idempotencyKey }
        assertEquals(2, keys.size)
        assertNotEquals(keys[0], keys[1])
    }

    @Test
    fun anOfflinePhoneKeepsTheFormAndSaysSo() {
        viewModel = model(origin = harness.closedOrigin())
        lendFifty()
        sent()
        assertEquals(WriteError.Offline, ui().error)
        assertEquals("50.00", ui().form.amount)
        assertFalse(ui().saving)
        assertEquals(0, viewModel.reread.value)
        assertNull(store.choices.loanAccountId)
    }

    @Test
    fun aViewerIsToldTheyCannotChangeTheLedger() {
        harness.route(Moves) { harness.json(403) }
        lendFifty()
        sent()
        assertEquals(WriteError.Forbidden, ui().error)
        assertEquals(0, viewModel.reread.value)
    }

    @Test
    fun aLoanThatChangedMeanwhileShowsTheServersSentenceAndTheScreenReadsAgain() {
        harness.route(Moves) { problem(409, "That is more than what is open. Lend or borrow instead.") }
        openSheet(LoanKind.Repay, listOf(theyOweUsd))
        viewModel.edit { it.copy(amount = "50.00", accountId = checking) }
        sent()
        assertEquals(WriteError.Rejected("That is more than what is open. Lend or borrow instead."), ui().error)
        assertEquals(1, viewModel.reread.value)
        harness.until { pulls.get() >= 1 }
        assertNull(store.choices.loanAccountId)
    }

    @Test
    fun aPersonWhoIsGoneIsAStaleAnswerToo() {
        harness.route(Moves) { problem(404, "Not found.") }
        lendFifty()
        sent()
        assertEquals(WriteError.Rejected("Not found."), ui().error)
        assertEquals(1, viewModel.reread.value)
    }

    @Test
    fun aRefusalThatIsNotStaleShowsTheSentenceWithoutReadingAgain() {
        harness.route(Moves) { problem(422, "Enter an amount greater than zero.") }
        lendFifty()
        sent()
        assertEquals(WriteError.Rejected("Enter an amount greater than zero."), ui().error)
        assertEquals(0, viewModel.reread.value)
        assertEquals(0, pulls.get())
    }

    @Test
    fun aSecondConfirmWhileSavingSendsNothingMore() {
        harness.delayMillis = 400
        lendFifty()
        viewModel.save()
        viewModel.confirm()
        assertTrue(ui().saving)
        viewModel.confirm()
        viewModel.save()
        harness.until { viewModel.sheet.value == null }
        assertEquals(1, writes().size)
    }

    @Test
    fun theFormCannotBeEditedWhileSaving() {
        harness.delayMillis = 400
        lendFifty()
        viewModel.save()
        viewModel.confirm()
        viewModel.edit { it.copy(amount = "999") }
        assertEquals("50.00", ui().form.amount)
        harness.until { viewModel.sheet.value == null }
    }

    @Test
    fun theSheetCannotBeClosedWhileSavingAndClosingForgetsItsKeys() {
        harness.route(Moves) { harness.json(500) }
        lendFifty()
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
        // Opened again, the same move starts with a new key.
        lendFifty()
        sent()
        assertNotEquals(first, writes().last().idempotencyKey)
    }

    @Test
    fun openingTheSheetAgainForgetsTheKeysOfTheLastOne() {
        harness.route(Moves) { harness.json(500) }
        lendFifty()
        sent()
        val first = writes().single().idempotencyKey
        lendFifty()
        sent()
        assertNotEquals(first, writes().last().idempotencyKey)
    }

    @Test
    fun aQuestionBeingAskedWhileTheSheetClosesIsGone() {
        lendFifty()
        viewModel.save()
        viewModel.close()
        assertNull(viewModel.sheet.value)
        viewModel.confirm()
        assertNothingWritten()
    }
}
