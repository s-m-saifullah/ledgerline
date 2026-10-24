package app.ledgerline.android.update

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.provider.Settings
import androidx.core.net.toUri
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/** Hands a verified APK to the system installer; the system asks the owner before anything is replaced. */
interface UpdateInstaller {
    /** Whether Android allows this app to install packages (its "Install unknown apps" switch). */
    fun canInstall(): Boolean

    /** Opens Android's own switch for this app. */
    fun openPermissionSettings()

    /** Starts an install session with [file]; the answer arrives at [UpdateInstallReceiver]. */
    suspend fun install(file: File)
}

@Singleton
class PackageUpdateInstaller @Inject constructor(@ApplicationContext private val context: Context) : UpdateInstaller {
    override fun canInstall() = context.packageManager.canRequestPackageInstalls()

    override fun openPermissionSettings() {
        context.startActivity(
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, "package:${context.packageName}".toUri())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    override suspend fun install(file: File) = withContext(Dispatchers.IO) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setSize(file.length())
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("update", 0, file.length()).use { out ->
                file.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            // The system fills in its confirmation intent, so the PendingIntent must be mutable; it names this app's receiver.
            val result = Intent(context, UpdateInstallReceiver::class.java).setPackage(context.packageName)
            val pending = PendingIntent.getBroadcast(context, id, result, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
            session.commit(pending.intentSender)
        }
    }
}
