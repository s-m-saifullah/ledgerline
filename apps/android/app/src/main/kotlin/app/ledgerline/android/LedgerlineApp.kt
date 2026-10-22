package app.ledgerline.android

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import app.ledgerline.android.session.SessionManager
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class LedgerlineApp : Application() {
    @Inject
    lateinit var session: SessionManager

    override fun onCreate() {
        super.onCreate()
        // The whole app going to the background (not a screen change) starts the lock timer.
        ProcessLifecycleOwner.get().lifecycle.addObserver(
            object : DefaultLifecycleObserver {
                override fun onStop(owner: LifecycleOwner) = session.appWentToBackground()

                override fun onStart(owner: LifecycleOwner) = session.appCameToForeground()
            },
        )
    }
}
