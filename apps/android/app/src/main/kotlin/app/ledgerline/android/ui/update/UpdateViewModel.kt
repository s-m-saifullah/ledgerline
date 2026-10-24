package app.ledgerline.android.ui.update

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.update.Release
import app.ledgerline.android.update.UpdateManager
import app.ledgerline.android.update.UpdateState
import app.ledgerline.android.update.noticeOf
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The update screen and the notices, over the one [UpdateManager]. */
@HiltViewModel
class UpdateViewModel @Inject constructor(private val manager: UpdateManager) : ViewModel() {
    val state: StateFlow<UpdateState> = manager.state

    /** The release the notices announce; null when none is known or the owner dismissed it. */
    val notice: StateFlow<Release?> = combine(manager.found, manager.dismissed, ::noticeOf)
        .stateIn(viewModelScope, SharingStarted.Eagerly, noticeOf(manager.found.value, manager.dismissed.value))

    /** The newer release known, dismissed or not: Settings names it. */
    val newer: StateFlow<Release?> = manager.found

    /** Whether this build can check for updates at all. */
    val enabled: Boolean get() = manager.enabled

    /** Once when the app opens; the manager applies the switch, the day limit and the connection. */
    fun checkOnLaunch() {
        viewModelScope.launch { manager.checkOnLaunch() }
    }

    fun checkNow() = manager.checkNow()

    fun download() = manager.download()

    fun cancel() = manager.cancelDownload()

    fun install() = manager.install()

    fun dismissNotice() = manager.dismissNotice()
}
