package app.ledgerline.android

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import app.ledgerline.android.session.SessionManager
import app.ledgerline.android.sync.SyncCoordinator
import app.ledgerline.android.update.UpdateManager
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltAndroidApp
class LedgerlineApp : Application() {
    @Inject
    lateinit var session: SessionManager

    @Inject
    lateinit var sync: SyncCoordinator

    // Lazy: the update manager is built, and started, off the main thread while the app is opening.
    @Inject
    lateinit var update: dagger.Lazy<UpdateManager>

    override fun onCreate() {
        super.onCreate()
        sync.start(CoroutineScope(SupervisorJob() + Dispatchers.Default))
        val background = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        background.launch { update.get().start(background) }
        // The whole app going to the background (not a screen change) starts the lock timer.
        ProcessLifecycleOwner.get().lifecycle.addObserver(
            object : DefaultLifecycleObserver {
                override fun onStop(owner: LifecycleOwner) = session.appWentToBackground()

                override fun onStart(owner: LifecycleOwner) {
                    session.appCameToForeground()
                    sync.appCameToForeground()
                }
            },
        )
    }
}
