package app.ledgerline.android.update

import app.ledgerline.android.settings.PhoneSettings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/** Wall-clock time, kept apart from the session's monotonic clock because the check's day limit must survive a restart. */
fun interface WallClock {
    fun nowMillis(): Long
}

/** The installed app, as the update check compares it. */
data class InstalledApp(val code: Int, val name: String, val packageName: String)

/** Why an update did not go ahead; the screen words each one. */
sealed interface UpdateProblem {
    data object Offline : UpdateProblem

    data object ServerError : UpdateProblem

    data class Refused(val why: Refusal) : UpdateProblem

    data object InstallFailed : UpdateProblem
}

/** Where the update stands. Only a button (or the launch check) moves it out of Idle. */
sealed interface UpdateState {
    data object Idle : UpdateState

    data object Checking : UpdateState

    data object UpToDate : UpdateState

    data class Available(val release: Release) : UpdateState

    data class Downloading(val release: Release, val received: Long) : UpdateState

    /** Downloaded and verified; the owner taps Install. [needsPermission]: Android has to allow installing from this app first. */
    data class Ready(val release: Release, val needsPermission: Boolean = false) : UpdateState

    data class Installing(val release: Release) : UpdateState

    data class Failed(val problem: UpdateProblem, val release: Release?) : UpdateState
}

/** The release the notices on Home and More announce: the one found, unless the owner dismissed that version. */
fun noticeOf(found: Release?, dismissed: Int): Release? = found?.takeIf { it.code != dismissed }

/** What the system installer reported. */
enum class InstallStatus { Installed, Aborted, Failed }

private const val DayMillis = 24L * 60 * 60 * 1000

/**
 * The in-app update (ADR 0043): finds a newer release on the button, or when the app opens (at most once a day, only
 * with the "Check for updates automatically" switch on), downloads it only when the owner asks, refuses it unless every
 * check passes ([verifyUpdate]) and hands it to the system installer, which asks the owner once more. Nothing here
 * runs in the background.
 */
@Singleton
class UpdateManager @Inject constructor(
    private val config: UpdateConfig,
    private val source: UpdateSource,
    private val files: UpdateFiles,
    private val reader: ApkReader,
    private val installer: UpdateInstaller,
    private val store: UpdateStore,
    private val settings: PhoneSettings,
    private val clock: WallClock,
    private val installed: InstalledApp,
) {
    private var scope: CoroutineScope? = null
    private var job: Job? = null

    private val _found = MutableStateFlow(store.found?.takeIf { it.code > installed.code })
    private val _dismissed = MutableStateFlow(store.dismissedCode)
    private val _state = MutableStateFlow<UpdateState>(_found.value?.let { UpdateState.Available(it) } ?: UpdateState.Idle)

    val state: StateFlow<UpdateState> = _state.asStateFlow()

    /** Whether this build can check at all (a release build without the pinned certificate cannot). */
    val enabled: Boolean get() = config.enabled

    /** The newest release found that is newer than the app, kept through restarts. */
    val found: StateFlow<Release?> = _found.asStateFlow()

    /** The version code whose notices were dismissed. */
    val dismissed: StateFlow<Int> = _dismissed.asStateFlow()

    fun start(scope: CoroutineScope) {
        this.scope = scope
        // A file left from an earlier run (an install that finished or never started) is not trusted again.
        files.deleteApk()
    }

    /** The "Check for updates" button. */
    fun checkNow() {
        if (!config.enabled || busy()) return
        scope?.launch { check(silent = false) }
    }

    /** The check when the app opens: once a day at most, only with the switch on; a failure says nothing. */
    suspend fun checkOnLaunch() {
        if (!config.enabled || !settings.autoUpdateCheck.value || busy()) return
        val last = store.lastCheckMillis
        val now = clock.nowMillis()
        // A clock set back counts as due, so the limit can never lock the check out.
        if (last in 1..now && now - last < DayMillis) return
        check(silent = true)
    }

    private suspend fun check(silent: Boolean) {
        val before = _state.value
        _state.value = UpdateState.Checking
        try {
            val newest = chooseRelease(source.releases())
            store.lastCheckMillis = clock.nowMillis()
            if (newest != null && newest.code > installed.code) {
                _found.value = newest
                store.found = newest
                _state.value = UpdateState.Available(newest)
            } else {
                _found.value = null
                store.found = null
                _state.value = UpdateState.UpToDate
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: UpdateIoException) {
            _state.value = if (silent) restore(before) else UpdateState.Failed(if (e.offline) UpdateProblem.Offline else UpdateProblem.ServerError, null)
        }
    }

    private fun restore(before: UpdateState): UpdateState = if (before is UpdateState.Checking) UpdateState.Idle else before

    /** The Download button (also "Try again" after a failure that has a release). */
    fun download() {
        val release = when (val s = _state.value) {
            is UpdateState.Available -> s.release
            is UpdateState.Failed -> s.release
            else -> null
        } ?: return
        job = scope?.launch { fetchAndVerify(release) }
    }

    private suspend fun fetchAndVerify(release: Release) {
        _state.value = UpdateState.Downloading(release, 0)
        try {
            val hash = files.hashText(release)
            val file = files.apk(release) { received -> _state.value = UpdateState.Downloading(release, received) }
            val pin = if (config.certPin == "own") reader.ownSignerSha256() else config.certPin
            val refusal = verifyUpdate(file, release, hash, installed.code, installed.packageName, pin, reader)
            if (refusal != null) {
                files.deleteApk()
                _state.value = UpdateState.Failed(UpdateProblem.Refused(refusal), release)
            } else {
                _state.value = UpdateState.Ready(release)
            }
        } catch (e: CancellationException) {
            files.deleteApk()
            _state.value = UpdateState.Available(release)
            throw e
        } catch (e: UpdateIoException) {
            files.deleteApk()
            _state.value = UpdateState.Failed(if (e.offline) UpdateProblem.Offline else UpdateProblem.ServerError, release)
        }
    }

    fun cancelDownload() {
        job?.cancel()
    }

    /** The Install button: Android's own "install unknown apps" switch first if it is off, then the system installer. */
    fun install() {
        val release = (_state.value as? UpdateState.Ready)?.release ?: return
        if (!installer.canInstall()) {
            _state.value = UpdateState.Ready(release, needsPermission = true)
            installer.openPermissionSettings()
            return
        }
        _state.value = UpdateState.Installing(release)
        scope?.launch {
            try {
                installer.install(files.apkFile())
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                files.deleteApk()
                _state.value = UpdateState.Failed(UpdateProblem.InstallFailed, release)
            }
        }
    }

    /** The system installer's answer (from [UpdateInstallReceiver]). A success replaces this process, so it needs no state. */
    fun onInstallStatus(status: InstallStatus) {
        val release = (_state.value as? UpdateState.Installing)?.release ?: return
        _state.value = when (status) {
            InstallStatus.Installed -> UpdateState.Idle
            InstallStatus.Aborted -> UpdateState.Ready(release)
            InstallStatus.Failed -> {
                files.deleteApk()
                UpdateState.Failed(UpdateProblem.InstallFailed, release)
            }
        }
    }

    /** The X on a notice: hides both notices for this version only; a newer release brings them back. */
    fun dismissNotice() {
        val code = _found.value?.code ?: return
        store.dismissedCode = code
        _dismissed.value = code
    }

    private fun busy() = _state.value.let { it is UpdateState.Checking || it is UpdateState.Downloading || it is UpdateState.Installing }
}
