package app.ledgerline.android.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.security.MessageDigest

private const val Pin = "e1962ec389f268fbefff81423e12a554a5b358b11bf7cec3a2192d54e1f2651d"
private const val Other = "0000000000000000000000000000000000000000000000000000000000000000"

class UpdateVerifierTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val content = "pretend apk".toByteArray()
    private val digest = MessageDigest.getInstance("SHA-256").digest(content).joinToString("") { "%02x".format(it) }
    private val release = Release("android-v0.1.3", "0.1.3", 103, "notes", "ledgerline-android-0.1.3.apk", content.size.toLong(), "ledgerline-android-0.1.3.apk.sha256")

    private class Reader(var info: ApkInfo?) : ApkReader {
        override fun read(file: File) = info

        override fun ownSignerSha256() = null
    }

    private fun apk(bytes: ByteArray = content) = folder.newFile().also { it.writeBytes(bytes) }

    private fun good() = ApkInfo("app.ledgerline.android", 103, listOf(Pin))

    private fun verify(
        file: File = apk(),
        release: Release = this.release,
        hash: String = "$digest  ledgerline-android-0.1.3.apk\n",
        installed: Int = 102,
        pin: String? = Pin,
        reader: ApkReader = Reader(good()),
    ) = verifyUpdate(file, release, hash, installed, "app.ledgerline.android", pin, reader)

    @Test
    fun aFileThatPassesEveryCheckIsAccepted() = assertNull(verify())

    @Test
    fun aWrongSizeIsRefusedFirst() {
        assertEquals(Refusal.SizeMismatch, verify(file = apk(content + 1), hash = "$Other  x"))
        assertNull(verify(release = release.copy(apkSize = 0)))
    }

    @Test
    fun theHashFileMustStartWithADigestAndTheFileMustMatchIt() {
        assertEquals(Refusal.HashFileInvalid, verify(hash = "not a digest"))
        assertEquals(Refusal.HashFileInvalid, verify(hash = ""))
        assertEquals(Refusal.HashMismatch, verify(hash = "$Other  x"))
        assertNull(verify(hash = digest.uppercase()))
        assertNull(verify(hash = "$digest\tledgerline-android-0.1.3.apk"))
    }

    @Test
    fun aFileTheSystemCannotReadIsRefused() = assertEquals(Refusal.Unreadable, verify(reader = Reader(null)))

    @Test
    fun theWrongPackageIsRefused() =
        assertEquals(Refusal.WrongPackage, verify(reader = Reader(good().copy(packageName = "app.ledgerline.android.debug"))))

    @Test
    fun theVersionCodeMustBeTheTagsAndHigherThanTheInstalledOne() {
        assertEquals(Refusal.WrongVersion, verify(reader = Reader(good().copy(versionCode = 104))))
        assertEquals(Refusal.NotNewer, verify(installed = 103))
        assertEquals(Refusal.NotNewer, verify(installed = 200))
    }

    @Test
    fun theSigningCertificateMustBeThePinnedOneAndTheOnlySigner() {
        assertEquals(Refusal.WrongCertificate, verify(reader = Reader(good().copy(signerSha256 = listOf(Other)))))
        assertEquals(Refusal.WrongCertificate, verify(reader = Reader(good().copy(signerSha256 = emptyList()))))
        assertEquals(Refusal.WrongCertificate, verify(reader = Reader(good().copy(signerSha256 = listOf(Pin, Other)))))
        assertEquals(Refusal.WrongCertificate, verify(reader = Reader(good().copy(signerSha256 = listOf(Pin, Pin)))))
    }

    @Test
    fun withoutAUsablePinNothingIsAccepted() {
        assertEquals(Refusal.WrongCertificate, verify(pin = null))
        assertEquals(Refusal.WrongCertificate, verify(pin = ""))
        assertEquals(Refusal.WrongCertificate, verify(pin = "abc"))
    }

    @Test
    fun thePinIsReadWithColonsAndInAnyCase() {
        assertNull(verify(pin = Pin.uppercase().chunked(2).joinToString(":")))
        assertEquals(Pin, normalizeFingerprint(" ${Pin.uppercase()} "))
    }
}
