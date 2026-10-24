package app.ledgerline.android.update

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import androidx.core.content.IntentCompat
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/** Receives the system installer's answers: its confirmation question, then the result. Nothing from them is logged. */
@AndroidEntryPoint
class UpdateInstallReceiver : BroadcastReceiver() {
    @Inject
    lateinit var manager: UpdateManager

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val question = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java) ?: return
                context.startActivity(question.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            PackageInstaller.STATUS_SUCCESS -> manager.onInstallStatus(InstallStatus.Installed)
            PackageInstaller.STATUS_FAILURE_ABORTED -> manager.onInstallStatus(InstallStatus.Aborted)
            else -> manager.onInstallStatus(InstallStatus.Failed)
        }
    }
}
