package app.ledgerline.android.ui.clients

import app.ledgerline.android.mirror.MirrorStore
import app.ledgerline.android.mirror.Stamp
import app.ledgerline.android.mirror.changes
import app.ledgerline.android.mirror.toRows
import app.ledgerline.android.online.ServiceWrites
import app.ledgerline.android.online.WriteError
import app.ledgerline.android.testing.OnlineHarness
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

private const val DeletePath = "/api/v1/ledgers/ledger-a/receivables/logo-refresh"

/** The Delete service question's logic (ADR 0050, slice 5b): the real mirror and clients against a mock server, and the real write path. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class DeleteServiceViewModelTest {
    private val harness = OnlineHarness()
    private lateinit var viewModel: DeleteServiceViewModel
    private val logo = service("Logo refresh", 45_000, id = "logo-refresh")

    private fun problem(status: Int, detail: String) =
        harness.json(status, """{"type":"about:blank","title":"x","status":$status,"detail":"$detail","errors":[]}""")

    private fun model(origin: String? = null): DeleteServiceViewModel {
        val writer = if (origin == null) harness.writer() else harness.writer(origin)
        return DeleteServiceViewModel(harness.database.reads(), ServiceWrites(writer))
    }

    @Before
    fun open() {
        harness.open()
        runBlocking { MirrorStore(harness.database).replaceAll("ledger-a", changes().toRows("ledger-a"), "c0", Stamp) }
        harness.route(DeletePath) { harness.json(204, "") }
        viewModel = model()
    }

    @After
    fun close() = harness.close()

    private fun ask(service: app.ledgerline.api.Service = logo): DeleteUi {
        viewModel.ask(service)
        harness.until { viewModel.question.value != null }
        return viewModel.question.value!!
    }

    private fun deletes() = harness.recorded.filter { it.method == "DELETE" }

    private fun confirmed() {
        viewModel.confirm()
        harness.until { viewModel.question.value?.saving != true }
    }

    @Test
    fun askingShowsTheServiceAndSendsNothing() {
        val shown = ask()
        assertEquals("Logo refresh", shown.description)
        assertFalse(shown.saving)
        assertNull(shown.error)
        assertTrue(harness.quiet())
        assertTrue(deletes().isEmpty())
    }

    @Test
    fun saidNoSendsNothingAndClosesTheQuestion() {
        ask()
        viewModel.dismiss()
        assertNull(viewModel.question.value)
        assertTrue(harness.quiet())
        assertTrue(deletes().isEmpty())
        assertEquals(0, viewModel.reread.value)
    }

    @Test
    fun confirmingWithoutBeingAskedSendsNothing() {
        viewModel.confirm()
        assertTrue(harness.quiet())
        assertTrue(deletes().isEmpty())
    }

    @Test
    fun confirmingSendsOneDeleteWithTheVersionTheKeyAndTheToken() {
        ask(service("Logo refresh", 45_000, id = "logo-refresh").copy(version = 4))
        viewModel.confirm()
        harness.until { viewModel.question.value == null }
        val write = deletes().single()
        assertEquals(DeletePath, write.target)
        assertEquals("""{"expectedVersion":4}""", write.body)
        assertTrue(Regex("^svcdel-[A-Za-z0-9._:-]{8,120}$").matches(write.idempotencyKey.orEmpty()))
        assertEquals("Bearer tok", harness.tokens.last())
    }

    @Test
    fun aDeletedServiceClosesTheQuestionAndTellsTheScreenToReadAgain() {
        ask()
        assertEquals(0, viewModel.reread.value)
        confirmed()
        harness.until { viewModel.question.value == null }
        assertEquals(1, viewModel.reread.value)
    }

    @Test
    fun aServiceWithPaymentsIsRefusedWithTheServersSentenceAndTheQuestionStays() {
        harness.route(DeletePath) { problem(409, "Delete the connected payments first.") }
        ask()
        confirmed()
        assertEquals(WriteError.Rejected("Delete the connected payments first."), viewModel.question.value!!.error)
        assertFalse(viewModel.question.value!!.saving)
        assertEquals(1, viewModel.reread.value)
    }

    @Test
    fun aServiceThatIsAlreadyGoneShowsTheSentenceAndTheScreenReadsAgain() {
        harness.route(DeletePath) { problem(404, "Service not found.") }
        ask()
        confirmed()
        assertEquals(WriteError.Rejected("Service not found."), viewModel.question.value!!.error)
        assertEquals(1, viewModel.reread.value)
    }

    @Test
    fun aRefusalThatIsNotStaleShowsTheSentenceWithoutReadingAgain() {
        harness.route(DeletePath) { problem(422, "Not allowed.") }
        ask()
        confirmed()
        assertEquals(WriteError.Rejected("Not allowed."), viewModel.question.value!!.error)
        assertEquals(0, viewModel.reread.value)
    }

    @Test
    fun aViewerIsToldTheyCannotDelete() {
        harness.route(DeletePath) { harness.json(403) }
        ask()
        confirmed()
        assertEquals(WriteError.Forbidden, viewModel.question.value!!.error)
    }

    @Test
    fun anOfflinePhoneSaysSoAndKeepsTheQuestion() {
        viewModel = model(origin = harness.closedOrigin())
        ask()
        confirmed()
        assertEquals(WriteError.Offline, viewModel.question.value!!.error)
        assertEquals(0, viewModel.reread.value)
    }

    @Test
    fun aFailedSendCanBeTriedAgainWithTheSameKey() {
        harness.route(DeletePath) { harness.json(500) }
        ask()
        confirmed()
        assertEquals(WriteError.Failed, viewModel.question.value!!.error)
        harness.route(DeletePath) { harness.json(204, "") }
        confirmed()
        harness.until { viewModel.question.value == null }
        val keys = deletes().map { it.idempotencyKey }
        assertEquals(2, keys.size)
        assertEquals(keys[0], keys[1])
    }

    @Test
    fun aSecondConfirmWhileSendingSendsNothingMore() {
        harness.delayMillis = 400
        ask()
        viewModel.confirm()
        assertTrue(viewModel.question.value!!.saving)
        viewModel.confirm()
        harness.until { viewModel.question.value == null }
        assertEquals(1, deletes().size)
    }

    @Test
    fun theQuestionCannotBeClosedWhileSending() {
        harness.delayMillis = 300
        ask()
        viewModel.confirm()
        viewModel.dismiss()
        assertTrue(viewModel.question.value != null)
        harness.until { viewModel.question.value == null }
        assertEquals(1, deletes().size)
    }

    @Test
    fun aQuestionAskedAgainStartsCleanWithANewKey() {
        harness.route(DeletePath) { harness.json(500) }
        ask()
        confirmed()
        val first = deletes().single().idempotencyKey
        viewModel.dismiss()
        val again = ask()
        assertNull(again.error)
        confirmed()
        assertNotEquals(first, deletes().last().idempotencyKey)
    }
}
