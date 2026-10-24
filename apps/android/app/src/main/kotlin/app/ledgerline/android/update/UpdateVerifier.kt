package app.ledgerline.android.update

import java.io.File
import java.security.MessageDigest

/** What the system says about an APK file: who it is, which version, and who signed it. */
data class ApkInfo(val packageName: String, val versionCode: Long, val signerSha256: List<String>)

/** Reads an APK file the way the installer will (PackageManager); a fake in tests. */
interface ApkReader {
    /** Null when the file is not an APK the system can read. */
    fun read(file: File): ApkInfo?

    /** The fingerprint of the certificate this app is itself signed with (the debug build's pin). */
    fun ownSignerSha256(): String?
}

/** Why a downloaded update is not installed. Each one deletes the file. */
enum class Refusal {
    SizeMismatch,
    HashFileInvalid,
    HashMismatch,
    Unreadable,
    WrongPackage,
    WrongVersion,
    NotNewer,
    WrongCertificate,
}

private val hex64 = Regex("[0-9a-f]{64}")

fun sha256Hex(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            digest.update(buffer, 0, read)
        }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
}

/** The digest in a `.sha256` file (`<64 hex digits>  <name>`), lower case; null when the file does not start with one. */
fun parseSha256File(text: String): String? =
    text.trim().substringBefore(' ').substringBefore('\t').lowercase().takeIf { hex64.matches(it) }

/** A fingerprint as 64 lower-case hex digits (colons and spaces dropped), or null. */
fun normalizeFingerprint(text: String): String? =
    text.replace(":", "").replace(" ", "").lowercase().takeIf { hex64.matches(it) }

/**
 * Everything checked before an update is handed to the installer (ADR 0043), in this order: the size, the SHA-256
 * against the release's `.sha256` file, that the system can read the APK, the package, the version code (the
 * tag's, and higher than the installed one) and **the signing certificate, which must be the pinned one and the
 * only signer**. The hash file sits beside the APK, so it only catches a damaged download; the pin is what stops a
 * swapped file. Returns null when all is well, otherwise the first refusal.
 */
fun verifyUpdate(
    file: File,
    release: Release,
    hashFileText: String,
    installedCode: Int,
    ownPackage: String,
    pin: String?,
    reader: ApkReader,
): Refusal? {
    if (release.apkSize > 0 && file.length() != release.apkSize) return Refusal.SizeMismatch
    val expected = parseSha256File(hashFileText) ?: return Refusal.HashFileInvalid
    if (sha256Hex(file) != expected) return Refusal.HashMismatch
    val info = reader.read(file) ?: return Refusal.Unreadable
    if (info.packageName != ownPackage) return Refusal.WrongPackage
    if (info.versionCode != release.code.toLong()) return Refusal.WrongVersion
    if (info.versionCode <= installedCode) return Refusal.NotNewer
    val wanted = pin?.let(::normalizeFingerprint) ?: return Refusal.WrongCertificate
    if (info.signerSha256.size != 1 || info.signerSha256.single() != wanted) return Refusal.WrongCertificate
    return null
}
