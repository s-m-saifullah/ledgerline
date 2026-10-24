package app.ledgerline.android.update

import android.content.Context
import android.content.pm.PackageManager
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.security.MessageDigest
import javax.inject.Inject

/** Reads an APK with PackageManager, the same parser the installer uses, so the checks see what the installer will. */
class AndroidApkReader @Inject constructor(@ApplicationContext private val context: Context) : ApkReader {
    override fun read(file: File): ApkInfo? {
        val info = context.packageManager.getPackageArchiveInfo(file.path, PackageManager.GET_SIGNING_CERTIFICATES) ?: return null
        val signers = info.signingInfo?.apkContentsSigners ?: return ApkInfo(info.packageName.orEmpty(), info.longVersionCode, emptyList())
        return ApkInfo(info.packageName.orEmpty(), info.longVersionCode, signers.map { fingerprint(it.toByteArray()) })
    }

    override fun ownSignerSha256(): String? {
        val info = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
        return info.signingInfo?.apkContentsSigners?.singleOrNull()?.let { fingerprint(it.toByteArray()) }
    }

    private fun fingerprint(certificate: ByteArray) =
        MessageDigest.getInstance("SHA-256").digest(certificate).joinToString("") { "%02x".format(it) }
}
