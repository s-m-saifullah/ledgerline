package app.ledgerline.android.ui.budgets

import app.ledgerline.android.online.BudgetWrites
import app.ledgerline.android.online.Online
import app.ledgerline.android.testing.OnlineHarness
import app.ledgerline.api.ApiJson
import app.ledgerline.api.Budget
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
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
import java.time.YearMonth

private val KeyPattern = Regex("^[A-Za-z0-9._:-]{8,128}$")

/** Setting and removing a limit, against a mock server and the real mirror: what is sent, what stays on screen, what reloads. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class BudgetLimitsViewModelTest {
    private val harness = OnlineHarness()
    private lateinit var model: BudgetsViewModel
    private lateinit var watching: Job
    private val now = YearMonth.now().toString()

    private val month get() = budgetMonth(now, listOf(budgetLine("Food", 10000, 2500, month = now), budgetLine("Fun", null, 400, month = now), budgetLine("Old", 500, 0, month = now).copy(archived = true)))
    private val food get() = month.items[0]
    private val fun_ get() = month.items[1]
    private val old get() = month.items[2]

    private fun saved(version: Int, amount: Long, rollover: Boolean = false) = ApiJson.encodeToString(
        Budget.serializer(),
        food.budget!!.copy(amount = food.budget!!.amount.copy(amount = amount), version = version, rollover = rollover),
    )

    private fun problem(status: Int, detail: String) =
        harness.json(status, """{"type":"about:blank","title":"x","status":$status,"detail":"$detail","errors":[]}""")

    private fun reads() = harness.recorded.filter { it.method == "GET" && it.target.startsWith("/api/v1/ledgers/ledger-a/budgets") }
    private fun writes() = harness.recorded.filter { it.method != "GET" }

    @Before
    fun open() {
        harness.open()
        harness.route("""^/api/v1/ledgers/ledger-a/budgets\?month=.*""") { harness.json(200, ApiJson.encodeToString(app.ledgerline.api.BudgetMonth.serializer(), month)) }
        model = BudgetsViewModel(harness.reader(), harness.database.reads(), BudgetWrites(harness.writer()))
        harness.pulled("2026-10-25T10:00:00.000Z")
        // The screen collects the month while it shows, and collecting is what starts the read.
        watching = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined).launch { model.budgets.collect { } }
        harness.until { model.budgets.value is Online.Ready }
    }

    @After
    fun close() {
        watching.cancel()
        harness.close()
    }

    private fun type(text: String) {
        model.editLimit(text)
    }

    private fun save() {
        model.saveLimit()
        harness.until { model.limit.value?.saving != true }
    }

    @Test
    fun aRowWithoutALimitOpensAnEmptyFormAndAnArchivedOneOpensNothing() {
        model.openLimit(fun_)
        assertEquals("", model.limit.value!!.form.text)
        model.closeLimit()
        assertNull(model.limit.value)
        model.openLimit(old)
        assertNull(model.limit.value)
    }

    @Test
    fun aRowWithALimitOpensItFilledIn() {
        model.openLimit(food)
        assertEquals("100.00", model.limit.value!!.form.text)
        assertTrue(model.limit.value!!.form.editing)
    }

    @Test
    fun aNewLimitIsSentOnceWithoutAVersionThenTheSheetClosesAndBudgetsReload() {
        harness.route("""^/api/v1/ledgers/ledger-a/budgets$""") { harness.json(201, saved(1, 7500)) }
        model.openLimit(fun_)
        type("75")
        val readsBefore = reads().size
        save()
        harness.until { reads().size > readsBefore }
        val sent = writes().single()
        assertEquals("PUT", sent.method)
        assertEquals("/api/v1/ledgers/ledger-a/budgets", sent.target)
        assertTrue(KeyPattern.matches(sent.idempotencyKey.orEmpty()))
        assertEquals("""{"categoryId":"${fun_.categoryId}","month":"$now","amount":{"amount":7500,"currency":"USD"},"rollover":false}""", sent.body)
        assertNull(model.limit.value)
    }

    @Test
    fun anEditSendsTheVersionAndKeepsRollover() {
        harness.route("""^/api/v1/ledgers/ledger-a/budgets$""") { harness.json(200, saved(2, 15000)) }
        model.openLimit(food)
        type("150")
        save()
        val body = writes().single().body
        assertTrue(body, body.contains(""""expectedVersion":1"""))
        assertTrue(body, body.contains(""""amount":15000"""))
        assertTrue(body, body.contains(""""rollover":false"""))
    }

    @Test
    fun nothingIsSentForAZeroABlankAnInvalidOrAnUnchangedAmount() {
        for (text in listOf("0", "", "abc", "100")) {
            model.openLimit(food)
            type(text)
            model.saveLimit()
            model.closeLimit()
        }
        // The month's own read is in the server's queue, so wait a little and look at what was written.
        Thread.sleep(400)
        assertEquals(emptyList<Any>(), writes())
    }

    @Test
    fun anOfflinePhoneKeepsTheSheetAndTheAmountAndSaysSo() {
        model = BudgetsViewModel(harness.reader(), harness.database.reads(), BudgetWrites(harness.writer(harness.closedOrigin())))
        model.openLimit(fun_)
        type("75")
        save()
        assertEquals(LimitError.Offline, model.limit.value!!.error)
        assertEquals("75", model.limit.value!!.form.text)
    }

    @Test
    fun aSecondTapWhileSavingSendsNothingMore() {
        harness.delayMillis = 300
        harness.route("""^/api/v1/ledgers/ledger-a/budgets$""") { harness.json(201, saved(1, 7500)) }
        model.openLimit(fun_)
        type("75")
        model.saveLimit()
        model.saveLimit()
        harness.until { model.limit.value == null }
        assertEquals(1, writes().size)
    }

    @Test
    fun aRepeatedSaveOfTheSameChangeReusesItsKeyAndAChangedAmountGetsANewOne() {
        harness.route("""^/api/v1/ledgers/ledger-a/budgets$""") { problem(500, "x") }
        model.openLimit(fun_)
        type("75")
        save()
        save()
        type("80")
        save()
        val keys = writes().map { it.idempotencyKey }
        assertEquals(3, keys.size)
        assertEquals(keys[0], keys[1])
        assertNotEquals(keys[1], keys[2])
    }

    @Test
    fun theServersSentenceIsShownAndAVersionThatMovedOnReloads() {
        harness.route("""^/api/v1/ledgers/ledger-a/budgets$""") { problem(409, "This budget changed. Reload and edit it.") }
        model.openLimit(food)
        type("150")
        val readsBefore = reads().size
        save()
        assertEquals(LimitError.Rejected("This budget changed. Reload and edit it."), model.limit.value!!.error)
        harness.until { reads().size > readsBefore }
    }

    @Test
    fun aViewerIsToldTheyCannotChangeBudgets() {
        harness.route("""^/api/v1/ledgers/ledger-a/budgets$""") { problem(403, "no") }
        model.openLimit(fun_)
        type("75")
        save()
        assertEquals(LimitError.Forbidden, model.limit.value!!.error)
    }

    @Test
    fun aServerErrorIsAFailureAndTheAmountStays() {
        harness.route("""^/api/v1/ledgers/ledger-a/budgets$""") { problem(500, "boom") }
        model.openLimit(fun_)
        type("75")
        save()
        assertEquals(LimitError.Failed, model.limit.value!!.error)
        assertEquals("75", model.limit.value!!.form.text)
    }

    @Test
    fun typingAgainClearsTheError() {
        harness.route("""^/api/v1/ledgers/ledger-a/budgets$""") { problem(500, "boom") }
        model.openLimit(fun_)
        type("75")
        save()
        type("76")
        assertNull(model.limit.value!!.error)
    }

    @Test
    fun aPresetFillsTheBoxInTheCurrencysDecimals() {
        model.openLimit(fun_)
        model.pickPreset(15_000)
        assertEquals("150.00", model.limit.value!!.form.text)
    }

    @Test
    fun removingAskedFirstSendsNothingUntilConfirmedThenDeletesWithTheVersion() {
        harness.route("""^/api/v1/ledgers/ledger-a/budgets/.*""") { harness.json(204, "") }
        model.openLimit(food)
        model.askRemove()
        assertTrue(model.limit.value!!.askRemove)
        assertEquals(emptyList<Any>(), writes())
        model.dismissRemove()
        assertFalse(model.limit.value!!.askRemove)
        model.askRemove()
        val readsBefore = reads().size
        model.confirmRemove()
        harness.until { model.limit.value == null }
        harness.until { reads().size > readsBefore }
        val sent = writes().single()
        assertEquals("DELETE", sent.method)
        assertEquals("/api/v1/ledgers/ledger-a/budgets/${food.budget!!.id}", sent.target)
        assertEquals("""{"expectedVersion":1}""", sent.body)
        assertTrue(KeyPattern.matches(sent.idempotencyKey.orEmpty()))
    }

    @Test
    fun aCategoryWithoutALimitCannotBeRemoved() {
        model.openLimit(fun_)
        model.askRemove()
        assertFalse(model.limit.value!!.askRemove)
        model.confirmRemove()
        assertEquals(emptyList<Any>(), writes())
    }

    @Test
    fun theSheetCannotBeClosedWhileItIsSaving() {
        harness.delayMillis = 300
        harness.route("""^/api/v1/ledgers/ledger-a/budgets$""") { harness.json(201, saved(1, 7500)) }
        model.openLimit(fun_)
        type("75")
        model.saveLimit()
        model.closeLimit()
        assertNotNull(model.limit.value)
        harness.until { model.limit.value == null }
    }

    @Test
    fun confirmingARemovalThatWasNeverAskedForSendsNothing() {
        model.openLimit(food)
        model.confirmRemove()
        Thread.sleep(400)
        assertEquals(emptyList<Any>(), writes())
    }

    @Test
    fun editingAndRemovingSendTheVersionThePhoneHolds() {
        harness.route("""^/api/v1/ledgers/ledger-a/budgets$""") { harness.json(200, saved(5, 15000)) }
        harness.route("""^/api/v1/ledgers/ledger-a/budgets/.*""") { harness.json(204, "") }
        val newer = food.copy(budget = food.budget!!.copy(version = 4))
        model.openLimit(newer)
        type("150")
        save()
        assertTrue(writes().single().body, writes().single().body.contains(""""expectedVersion":4"""))
        model.openLimit(newer)
        model.askRemove()
        model.confirmRemove()
        harness.until { writes().size == 2 }
        assertEquals("""{"expectedVersion":4}""", writes()[1].body)
    }
}
