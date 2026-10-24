package app.ledgerline.android.update

import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** The list reader and the file fetcher, against a scratch server standing in for GitHub (the debug configuration). */
class GithubUpdateSourceTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val server = MockWebServer()
    private lateinit var source: GithubUpdateSource
    private val release = Release("android-v0.1.3", "0.1.3", 103, "", "ledgerline-android-0.1.3.apk", 0, "ledgerline-android-0.1.3.apk.sha256")

    @Before
    fun start() {
        server.start()
        val base = server.url("/").toString().trimEnd('/')
        source = GithubUpdateSource(OkHttpClient(), UpdateConfig("owner/repo", base, base, "own", allowCleartext = true), "Ledgerline-Android/9.9.9", folder.newFolder())
    }

    @After
    fun stop() = server.close()

    private fun text(body: String, code: Int = 200) = server.enqueue(MockResponse.Builder().code(code).body(body).build())

    @Test
    fun theListIsReadFromTheRepositoryPathWithNothingButTheAppNameAndVersion() = runBlocking {
        text("""[{"tag_name":"android-v0.1.3","assets":[]}]""")
        val list = source.releases()
        assertEquals("android-v0.1.3", list.single().tagName)
        val request = server.takeRequest()
        assertEquals("/repos/owner/repo/releases?per_page=30", request.url.encodedPath + "?" + request.url.encodedQuery)
        assertEquals("Ledgerline-Android/9.9.9", request.headers["User-Agent"])
        assertNull(request.headers["Authorization"])
        assertNull(request.headers["Cookie"])
        assertEquals("application/vnd.github+json", request.headers["Accept"])
    }

    @Test
    fun anAnswerThatIsNotAReleaseListIsAServerProblem() {
        text("""{"message":"Not Found"}""")
        val failure = assertThrows(UpdateIoException::class.java) { runBlocking { source.releases() } }
        assertFalse(failure.offline)
    }

    @Test
    fun aRefusalFromTheServerIsAServerProblemNotAnOfflineOne() {
        text("rate limited", code = 403)
        assertFalse(assertThrows(UpdateIoException::class.java) { runBlocking { source.releases() } }.offline)
    }

    @Test
    fun noConnectionIsOffline() {
        server.close()
        assertTrue(assertThrows(UpdateIoException::class.java) { runBlocking { source.releases() } }.offline)
    }

    @Test
    fun theHashFileIsFetchedFromTheTagsDownloadPath() = runBlocking {
        text("abc  file\n")
        assertEquals("abc  file\n", source.hashText(release))
        assertEquals("/owner/repo/releases/download/android-v0.1.3/ledgerline-android-0.1.3.apk.sha256", server.takeRequest().url.encodedPath)
    }

    @Test
    fun theApkIsWrittenToThePrivateFileAndProgressIsReported() = runBlocking {
        text("x".repeat(200_000))
        val seen = mutableListOf<Long>()
        val file = source.apk(release) { seen += it }
        assertEquals(200_000L, file.length())
        assertEquals(200_000L, seen.last())
        assertTrue(seen.zipWithNext().all { (a, b) -> b >= a })
        assertEquals(file, source.apkFile())
    }

    @Test
    fun aFailedDownloadLeavesNoFileBehind() {
        text("gone", code = 404)
        assertThrows(UpdateIoException::class.java) { runBlocking { source.apk(release) {} } }
        assertFalse(source.apkFile().exists())
    }

    @Test
    fun deletingRemovesTheFile() = runBlocking {
        text("x")
        val file = source.apk(release) {}
        assertTrue(file.exists())
        source.deleteApk()
        assertFalse(file.exists())
    }

    @Test
    fun aRedirectToAnAllowedHostIsFollowed() = runBlocking {
        server.enqueue(MockResponse.Builder().code(302).addHeader("Location", server.url("/elsewhere").toString()).build())
        text("done")
        assertEquals("done", source.hashText(release))
        assertEquals(2, server.requestCount)
    }

    @Test
    fun aRedirectToAnotherHostIsRefusedBeforeAnyRequestIsSentThere() {
        server.enqueue(MockResponse.Builder().code(302).addHeader("Location", "http://203.0.113.9/steal").build())
        val failure = assertThrows(UpdateIoException::class.java) { runBlocking { source.hashText(release) } }
        assertFalse(failure.offline)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun aRedirectToPlainHttpOnAGithubHostIsRefused() {
        server.enqueue(MockResponse.Builder().code(302).addHeader("Location", "http://github.com/x").build())
        assertThrows(UpdateIoException::class.java) { runBlocking { source.hashText(release) } }
        assertEquals(1, server.requestCount)
    }

    @Test
    fun aLoopOfRedirectsEndsAfterFive() {
        repeat(10) { server.enqueue(MockResponse.Builder().code(302).addHeader("Location", server.url("/again").toString()).build()) }
        assertThrows(UpdateIoException::class.java) { runBlocking { source.hashText(release) } }
        assertEquals(6, server.requestCount)
    }

    @Test
    fun aHashFileLargerThanItShouldBeIsRefused() {
        text("a".repeat(5000))
        assertThrows(UpdateIoException::class.java) { runBlocking { source.hashText(release) } }
    }
}
