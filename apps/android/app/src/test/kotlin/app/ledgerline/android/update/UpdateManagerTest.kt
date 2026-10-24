package app.ledgerline.android.update

import app.ledgerline.android.testing.FakePhoneSettings
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.security.MessageDigest

private const val Pin = "e1962ec389f268fbefff81423e12a554a5b358b11bf7cec3a2192d54e1f2651d"
private const val Day = 24L * 60 * 60 * 1000

private fun github(tag: String) = GithubRelease(
    tag, false, false, "Notes of $tag\n---\nhashes",
    listOf("ledgerline-android-${tag.removePrefix("android-v")}.apk", "ledgerline-android-${tag.removePrefix("android-v")}.apk.sha256").map { GithubAsset(it, 11) },
)

@OptIn(ExperimentalCoroutinesApi::class)
class UpdateManagerTest {
    @get:Rule
    val folder = TemporaryFolder()

    private class Source(var list: List<GithubRelease> = emptyList(), var failure: UpdateIoException? = null) : UpdateSource {
        var calls = 0

        override suspend fun releases(): List<GithubRelease> {
            calls++
            failure?.let { throw it }
            return list
        }
    }

    private inner class Files : UpdateFiles {
        val apk: File get() = File(folder.root, "update.apk")
        var failure: UpdateIoException? = null
        var content = "pretend apk".toByteArray()
        var hashOverride: String? = null
        var gate: CompletableDeferred<Unit>? = null
        var deletes = 0

        override suspend fun hashText(release: Release): String =
            hashOverride ?: (MessageDigest.getInstance("SHA-256").digest(content).joinToString("") { "%02x".format(it) } + "  f\n")

        override suspend fun apk(release: Release, onProgress: (Long) -> Unit): File {
            failure?.let { throw it }
            gate?.await()
            apk.writeBytes(content)
            onProgress(content.size.toLong())
            return apk
        }

        override fun apkFile() = apk

        override fun deleteApk() {
            deletes++
            apk.delete()
        }
    }

    private class Reader(var info: ApkInfo?) : ApkReader {
        override fun read(file: File) = info

        override fun ownSignerSha256() = Pin
    }

    private class Installer(var allowed: Boolean = true) : UpdateInstaller {
        var settingsOpened = 0
        val installed = mutableListOf<File>()
        var failure: Exception? = null

        override fun canInstall() = allowed

        override fun openPermissionSettings() { settingsOpened++ }

        override suspend fun install(file: File) {
            failure?.let { throw it }
            installed += file
        }
    }

    private class Store : UpdateStore {
        override var lastCheckMillis = 0L
        override var found: Release? = null
        override var dismissedCode = 0
    }

    private var now = 1_000_000_000_000L
    private val source = Source(listOf(github("android-v0.1.3")))
    private val files = Files()
    private val reader = Reader(ApkInfo("app.ledgerline.android", 103, listOf(Pin)))
    private val installer = Installer()
    private val store = Store()
    private val settings = FakePhoneSettings()
    private lateinit var scope: TestScope
    private lateinit var manager: UpdateManager

    private fun build(config: UpdateConfig = UpdateConfig("o/r", "https://api.github.com", "https://github.com", Pin, false), installedCode: Int = 102): UpdateManager {
        scope = TestScope(UnconfinedTestDispatcher())
        return UpdateManager(config, source, files, reader, installer, store, settings, { now }, InstalledApp(installedCode, "0.1.2", "app.ledgerline.android")).also {
            it.start(scope)
        }
    }

    @Before
    fun setUp() {
        manager = build()
    }

    @Test
    fun nothingIsRequestedUntilTheOwnerPressesOrTheAppOpens() {
        assertEquals(0, source.calls)
        assertEquals(UpdateState.Idle, manager.state.value)
        // Starting clears any file an earlier run left, once.
        assertEquals(1, files.deletes)
    }

    @Test
    fun theButtonFindsANewerReleaseAndKeepsItForTheNotices() {
        manager.checkNow()
        val state = manager.state.value as UpdateState.Available
        assertEquals("0.1.3", state.release.name)
        assertEquals("Notes of android-v0.1.3", state.release.notes)
        assertEquals(state.release, store.found)
        assertEquals(now, store.lastCheckMillis)
        assertEquals(state.release, manager.found.value)
    }

    @Test
    fun theSameOrAnOlderReleaseIsUpToDateAndClearsAStaleNotice() {
        store.found = chooseRelease(listOf(github("android-v0.1.3")))
        manager = build(installedCode = 103)
        assertNull(manager.found.value)
        manager.checkNow()
        assertEquals(UpdateState.UpToDate, manager.state.value)
        assertNull(store.found)
        source.list = emptyList()
        manager.checkNow()
        assertEquals(UpdateState.UpToDate, manager.state.value)
    }

    @Test
    fun aFailedButtonCheckSaysWhyAndKeepsTheDay() {
        source.failure = UpdateIoException(offline = true, "x")
        manager.checkNow()
        assertEquals(UpdateState.Failed(UpdateProblem.Offline, null), manager.state.value)
        assertEquals(0L, store.lastCheckMillis)
        source.failure = UpdateIoException(offline = false, "x")
        manager.checkNow()
        assertEquals(UpdateState.Failed(UpdateProblem.ServerError, null), manager.state.value)
    }

    @Test
    fun aBuildWithoutAPinNeverAsksAnyone() = runTest {
        manager = build(UpdateConfig("o/r", "https://api.github.com", "https://github.com", "", false))
        assertFalse(manager.enabled)
        manager.checkNow()
        manager.checkOnLaunch()
        assertEquals(0, source.calls)
        assertEquals(UpdateState.Idle, manager.state.value)
    }

    @Test
    fun theLaunchCheckRunsOnceADayAtMost() = runTest {
        manager.checkOnLaunch()
        assertEquals(1, source.calls)
        now += Day - 1
        manager.checkOnLaunch()
        assertEquals(1, source.calls)
        now += 1
        manager.checkOnLaunch()
        assertEquals(2, source.calls)
    }

    @Test
    fun theSwitchTurnsTheLaunchCheckOffButNotTheButton() = runTest {
        settings.setAutoUpdateCheck(false)
        manager.checkOnLaunch()
        assertEquals(0, source.calls)
        manager.checkNow()
        assertEquals(1, source.calls)
        settings.setAutoUpdateCheck(true)
        now += Day
        manager.checkOnLaunch()
        assertEquals(2, source.calls)
    }

    @Test
    fun aClockSetBackNeverLocksTheLaunchCheckOut() = runTest {
        store.lastCheckMillis = now + 5 * Day
        manager.checkOnLaunch()
        assertEquals(1, source.calls)
    }

    @Test
    fun aFailedLaunchCheckSaysNothingAndDoesNotUseUpTheDay() = runTest {
        source.failure = UpdateIoException(offline = true, "x")
        manager.checkOnLaunch()
        assertEquals(UpdateState.Idle, manager.state.value)
        assertEquals(0L, store.lastCheckMillis)
        source.failure = null
        manager.checkOnLaunch()
        assertEquals(2, source.calls)
        assertTrue(manager.state.value is UpdateState.Available)
    }

    @Test
    fun aReleaseFoundEarlierIsAvailableAfterARestart() {
        manager.checkNow()
        val again = build()
        assertTrue(again.state.value is UpdateState.Available)
        assertEquals("0.1.3", again.found.value?.name)
    }

    @Test
    fun downloadingChecksTheFileAndLeavesItReadyToInstall() {
        manager.checkNow()
        manager.download()
        assertTrue(manager.state.value is UpdateState.Ready)
        assertTrue(files.apk.exists())
    }

    @Test
    fun aFileThatFailsACheckIsDeletedAndNeverOffered() {
        manager.checkNow()
        files.hashOverride = "0".repeat(64)
        manager.download()
        assertEquals(UpdateProblem.Refused(Refusal.HashMismatch), (manager.state.value as UpdateState.Failed).problem)
        assertFalse(files.apk.exists())
        files.hashOverride = null
        reader.info = ApkInfo("app.ledgerline.android", 103, listOf("1".repeat(64)))
        manager.download()
        assertEquals(UpdateProblem.Refused(Refusal.WrongCertificate), (manager.state.value as UpdateState.Failed).problem)
        assertFalse(files.apk.exists())
        manager.install()
        assertTrue(installer.installed.isEmpty())
    }

    @Test
    fun theDebugBuildHoldsAnUpdateToItsOwnKey() {
        manager = build(UpdateConfig("o/r", "http://localhost:3103", "http://localhost:3103", "own", true))
        manager.checkNow()
        manager.download()
        assertTrue(manager.state.value is UpdateState.Ready)
        manager = build(UpdateConfig("o/r", "http://localhost:3103", "http://localhost:3103", "own", true))
        reader.info = ApkInfo("app.ledgerline.android", 103, listOf("1".repeat(64)))
        manager.checkNow()
        manager.download()
        assertEquals(UpdateProblem.Refused(Refusal.WrongCertificate), (manager.state.value as UpdateState.Failed).problem)
    }

    @Test
    fun aFailedDownloadCanBeTriedAgain() {
        manager.checkNow()
        files.failure = UpdateIoException(offline = true, "x")
        manager.download()
        val failed = manager.state.value as UpdateState.Failed
        assertEquals(UpdateProblem.Offline, failed.problem)
        assertFalse(files.apk.exists())
        files.failure = null
        manager.download()
        assertTrue(manager.state.value is UpdateState.Ready)
    }

    @Test
    fun cancellingADownloadGoesBackToAvailableAndDeletesTheFile() {
        manager.checkNow()
        files.gate = CompletableDeferred()
        manager.download()
        assertTrue(manager.state.value is UpdateState.Downloading)
        manager.cancelDownload()
        assertTrue(manager.state.value is UpdateState.Available)
        assertFalse(files.apk.exists())
    }

    @Test
    fun nothingHappensOutOfOrder() {
        manager.install()
        manager.download()
        assertEquals(UpdateState.Idle, manager.state.value)
        manager.checkNow()
        manager.install()
        assertTrue(manager.state.value is UpdateState.Available)
        assertTrue(installer.installed.isEmpty())
    }

    @Test
    fun installAsksAndroidToAllowInstallsFirstAndThenHandsOverTheFile() {
        manager.checkNow()
        manager.download()
        installer.allowed = false
        manager.install()
        assertEquals(UpdateState.Ready((manager.found.value!!), needsPermission = true), manager.state.value)
        assertEquals(1, installer.settingsOpened)
        assertTrue(installer.installed.isEmpty())
        installer.allowed = true
        manager.install()
        assertEquals(listOf(files.apk), installer.installed)
        assertTrue(manager.state.value is UpdateState.Installing)
    }

    @Test
    fun theInstallersAnswersMoveTheState() {
        manager.checkNow()
        manager.download()
        manager.install()
        manager.onInstallStatus(InstallStatus.Aborted)
        assertTrue(manager.state.value is UpdateState.Ready)
        manager.install()
        manager.onInstallStatus(InstallStatus.Failed)
        assertEquals(UpdateProblem.InstallFailed, (manager.state.value as UpdateState.Failed).problem)
        assertFalse(files.apk.exists())
    }

    @Test
    fun anInstallThatCannotStartIsAFailureAndDeletesTheFile() {
        manager.checkNow()
        manager.download()
        installer.failure = IllegalStateException("x")
        manager.install()
        assertEquals(UpdateProblem.InstallFailed, (manager.state.value as UpdateState.Failed).problem)
        assertFalse(files.apk.exists())
    }

    @Test
    fun anAnswerWhenNothingIsInstallingIsIgnored() {
        manager.onInstallStatus(InstallStatus.Failed)
        assertEquals(UpdateState.Idle, manager.state.value)
    }

    @Test
    fun dismissingHidesTheNoticesForThatVersionOnlyAndKeepsTheUpdate() {
        manager.checkNow()
        val first = manager.found.value!!
        assertEquals(first, noticeOf(manager.found.value, manager.dismissed.value))
        manager.dismissNotice()
        assertNull(noticeOf(manager.found.value, manager.dismissed.value))
        assertEquals(first.code, store.dismissedCode)
        assertEquals(first, manager.found.value)
        assertTrue(manager.state.value is UpdateState.Available)
        // A restart keeps it dismissed; a newer release brings the notices back.
        val again = build()
        assertNull(noticeOf(again.found.value, again.dismissed.value))
        source.list = listOf(github("android-v0.1.4"))
        again.checkNow()
        assertEquals("0.1.4", noticeOf(again.found.value, again.dismissed.value)?.name)
    }

    @Test
    fun aFileLeftFromAnEarlierRunIsDeletedAtStart() {
        files.apk.writeBytes(byteArrayOf(1))
        build()
        assertFalse(files.apk.exists())
    }
}
