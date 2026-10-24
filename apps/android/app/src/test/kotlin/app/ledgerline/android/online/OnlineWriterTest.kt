package app.ledgerline.android.online

import app.ledgerline.android.session.SessionState
import app.ledgerline.android.testing.OnlineHarness
import app.ledgerline.api.ExpectedVersion
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** How an online write ends: done, no connection, refused with the server's sentence, not allowed, or failed. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class OnlineWriterTest {
    private val harness = OnlineHarness()

    @Before
    fun open() = harness.open()

    @After
    fun close() = harness.close()

    private fun archive() = runBlocking { harness.writer().write { archiveCategory("ledger-a", "c1", "cat-key-0001", ExpectedVersion(2)) } }

    private fun problem(status: Int, detail: String) =
        harness.json(status, """{"type":"about:blank","title":"x","status":$status,"detail":"$detail","errors":[{"field":"name","message":"m"}]}""")

    @Test
    fun aRefusalWithAProblemCarriesItsSentence() {
        harness.route(".*") { problem(409, "A sibling category already has this name.") }
        assertEquals(Written.Rejected(409, "A sibling category already has this name."), archive())
        harness.route(".*") { problem(404, "Category not found.") }
        assertEquals(Written.Rejected(404, "Category not found."), archive())
    }

    @Test
    fun aRefusalWithNothingReadableHasNoSentence() {
        harness.route(".*") { harness.json(422, "<html>no</html>") }
        assertEquals(Written.Rejected(422, null), archive())
    }

    @Test
    fun anAccountThatMayNotWriteIsToldSo() {
        harness.route(".*") { problem(403, "Not allowed.") }
        assertEquals(Written.Forbidden, archive())
    }

    @Test
    fun aServerFailureIsAFailure() {
        harness.route(".*") { harness.json(500, "{}") }
        assertEquals(Written.Failed, archive())
        harness.route(".*") { harness.json(503, "") }
        assertEquals(Written.Failed, archive())
    }

    @Test
    fun aRefusedTokenEndsTheSession() {
        harness.route(".*") { problem(401, "Sign in.") }
        assertEquals(Written.Failed, archive())
        assertNotEquals(SessionState.Unlocked, harness.session.state.value)
    }

    @Test
    fun noConnectionIsOfflineAndSendsNothingToAnyoneElse() = runBlocking {
        val result = harness.writer(harness.closedOrigin()).write { archiveCategory("ledger-a", "c1", "cat-key-0001", ExpectedVersion(2)) }
        assertEquals(Written.Offline, result)
        assertTrue(harness.recorded.isEmpty())
    }

    @Test
    fun theWriteCarriesTheKeyTheTokenAndTheBodyAsAPost() {
        harness.route(".*") { problem(409, "x") }
        archive()
        val sent = harness.recorded.single()
        assertEquals("POST", sent.method)
        assertEquals("/api/v1/ledgers/ledger-a/categories/c1/archive", sent.target)
        assertEquals("cat-key-0001", sent.idempotencyKey)
        assertEquals("""{"expectedVersion":2}""", sent.body)
        assertEquals("Bearer tok", harness.tokens.single())
    }

    @Test
    fun aDeleteIsADeleteWithABodyAndANoContentAnswerIsDone() {
        harness.route(".*") { harness.json(204, "") }
        val result = runBlocking { harness.writer().write { deleteCategory("ledger-a", "c1", "cat-key-0002", ExpectedVersion(3)) } }
        assertEquals(Written.Done(Unit), result)
        val sent = harness.recorded.single()
        assertEquals("DELETE", sent.method)
        assertEquals("/api/v1/ledgers/ledger-a/categories/c1", sent.target)
        assertEquals("cat-key-0002", sent.idempotencyKey)
        assertEquals("""{"expectedVersion":3}""", sent.body)
    }
}
