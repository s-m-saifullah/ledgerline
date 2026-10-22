package app.ledgerline.android.session

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.fragment.app.FragmentActivity
import app.ledgerline.android.R
import app.ledgerline.api.SessionToken
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.suspendCancellableCoroutine
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/** The activity that can show the fingerprint prompt; set by MainActivity while it exists. */
@Singleton
class PromptHost @Inject constructor() {
    @Volatile
    var activity: FragmentActivity? = null
}

/**
 * [TokenProtector] with an app-level lock (ADR 0043). The token is stored encrypted with an AES-256-GCM key that
 * lives in the Android Keystore (hardware-backed where the phone has it, never leaves it, and is not included in
 * backups), and the app asks for the owner's fingerprint or screen lock before it stores or opens the token.
 *
 * The key itself does not demand a confirmation: tying it to one made the Keystore on the owner's phone reject
 * fingerprint confirmations unreliably. The cost is that code running inside the app on a rooted phone could open
 * the token without the prompt; a lost or borrowed phone is still stopped by the prompt and the screen lock.
 * Verified on a real phone, not on the JVM.
 */
@Singleton
class KeystoreTokenProtector @Inject constructor(
    @ApplicationContext private val context: Context,
    private val host: PromptHost,
) : TokenProtector {
    private val prefs = context.getSharedPreferences("vault", Context.MODE_PRIVATE)
    private val authenticators = BIOMETRIC_STRONG or DEVICE_CREDENTIAL

    override fun protection(): Protection =
        when (BiometricManager.from(context).canAuthenticate(authenticators)) {
            BiometricManager.BIOMETRIC_SUCCESS -> Protection.Available
            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> Protection.NoScreenLock
            else -> Protection.Unavailable
        }

    override fun hasStored() = prefs.contains(StoredToken) && prefs.contains(StoredIv)

    override suspend fun protect(token: SessionToken): ProtectOutcome {
        val activity = host.activity ?: return ProtectOutcome.Failed(detail = "no-activity")
        // Confirm first, so nothing is created or stored unless the owner agrees.
        when (val result = confirm(activity, R.string.lock_prompt_protect)) {
            Confirmation.Cancelled -> return ProtectOutcome.Cancelled
            is Confirmation.Failed -> return ProtectOutcome.Failed(result.lockedOut, result.detail)
            Confirmation.Done -> Unit
        }
        discard()
        return try {
            createKey()
            val cipher = Cipher.getInstance(Transformation).apply { init(Cipher.ENCRYPT_MODE, key()) }
            val encrypted = cipher.doFinal(token.value.toByteArray(Charsets.UTF_8))
            // commit, not apply: the token must be on disk before the owner is told it is saved.
            prefs.edit(commit = true) {
                putString(StoredToken, Base64.encodeToString(encrypted, Base64.NO_WRAP))
                putString(StoredIv, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            }
            ProtectOutcome.Saved
        } catch (e: GeneralSecurityException) {
            discard()
            ProtectOutcome.Failed(detail = e.reason("store"))
        } catch (e: RuntimeException) {
            discard()
            ProtectOutcome.Failed(detail = e.reason("store"))
        }
    }

    override suspend fun unlock(): UnlockOutcome {
        val activity = host.activity ?: return UnlockOutcome.Failed(detail = "no-activity")
        val encrypted = prefs.getString(StoredToken, null)?.let { Base64.decode(it, Base64.NO_WRAP) }
        val iv = prefs.getString(StoredIv, null)?.let { Base64.decode(it, Base64.NO_WRAP) }
        if (encrypted == null || iv == null) return UnlockOutcome.KeyLost
        // Without a screen lock or fingerprint on the phone the prompt cannot be satisfied, so the saved sign-in
        // can no longer be protected: treat it as lost and let the owner sign in again.
        if (protection() != Protection.Available) return UnlockOutcome.KeyLost
        when (val result = confirm(activity, R.string.lock_prompt_unlock)) {
            Confirmation.Cancelled -> return UnlockOutcome.Cancelled
            is Confirmation.Failed -> return UnlockOutcome.Failed(result.lockedOut, result.detail)
            Confirmation.Done -> Unit
        }
        return openStored(encrypted, iv)
    }

    override fun readForSync(): SessionToken? {
        val encrypted = prefs.getString(StoredToken, null)?.let { Base64.decode(it, Base64.NO_WRAP) } ?: return null
        val iv = prefs.getString(StoredIv, null)?.let { Base64.decode(it, Base64.NO_WRAP) } ?: return null
        if (protection() != Protection.Available) return null
        return (openStored(encrypted, iv) as? UnlockOutcome.Unlocked)?.token
    }

    private fun openStored(encrypted: ByteArray, iv: ByteArray): UnlockOutcome {
        return try {
            val key = key() ?: return UnlockOutcome.KeyLost
            val cipher = Cipher.getInstance(Transformation).apply {
                init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
            }
            UnlockOutcome.Unlocked(SessionToken(String(cipher.doFinal(encrypted), Charsets.UTF_8)))
        } catch (_: AEADBadTagException) {
            // The stored copy is damaged or belongs to another key; it can never be opened.
            UnlockOutcome.KeyLost
        } catch (e: GeneralSecurityException) {
            // A key the system has invalidated or removed can never open the token again.
            if (key() == null) UnlockOutcome.KeyLost else UnlockOutcome.Failed(detail = e.reason("open"))
        } catch (e: RuntimeException) {
            UnlockOutcome.Failed(detail = e.reason("open"))
        }
    }

    override fun discard() {
        prefs.edit(commit = true) {
            remove(StoredToken)
            remove(StoredIv)
        }
        try {
            keyStore().deleteEntry(KeyAlias)
        } catch (_: GeneralSecurityException) {
        }
    }

    /** A short code for debug builds: the exception names down the cause chain and the root cause's message. */
    private fun Throwable.reason(stage: String): String {
        val names = generateSequence(this) { it.cause }.take(4).toList()
        val root = names.last().message?.take(90)?.replace(Regex("[\\r\\n]+"), " ")
        return "$stage:" + names.joinToString("/") { it.javaClass.simpleName } + (root?.let { " ($it)" } ?: "")
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(AndroidKeyStore).apply { load(null) }

    private fun key(): SecretKey? = try {
        keyStore().getKey(KeyAlias, null) as? SecretKey
    } catch (_: GeneralSecurityException) {
        null
    }

    private fun createKey() {
        val spec = KeyGenParameterSpec.Builder(KeyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, AndroidKeyStore).apply { init(spec) }.generateKey()
    }

    private sealed interface Confirmation {
        data object Done : Confirmation
        data object Cancelled : Confirmation
        data class Failed(val lockedOut: Boolean, val detail: String? = null) : Confirmation
    }

    /** Shows the system fingerprint or screen-lock prompt and reports what the owner did. */
    private suspend fun confirm(activity: FragmentActivity, title: Int): Confirmation =
        suspendCancellableCoroutine { continuation ->
            val callback = object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    if (continuation.isActive) continuation.resume(Confirmation.Done)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    if (!continuation.isActive) return
                    continuation.resume(
                        when (errorCode) {
                            BiometricPrompt.ERROR_USER_CANCELED,
                            BiometricPrompt.ERROR_NEGATIVE_BUTTON,
                            BiometricPrompt.ERROR_CANCELED,
                            -> Confirmation.Cancelled
                            BiometricPrompt.ERROR_LOCKOUT,
                            BiometricPrompt.ERROR_LOCKOUT_PERMANENT,
                            -> Confirmation.Failed(lockedOut = true, detail = "prompt:$errorCode")
                            else -> Confirmation.Failed(lockedOut = false, detail = "prompt:$errorCode")
                        },
                    )
                }
            }
            val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback)
            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle(context.getString(title))
                .setAllowedAuthenticators(authenticators)
                .setConfirmationRequired(false)
                .build()
            try {
                prompt.authenticate(info)
            } catch (e: RuntimeException) {
                if (continuation.isActive) continuation.resume(Confirmation.Failed(false, "show:${e.javaClass.simpleName}"))
                return@suspendCancellableCoroutine
            }
            continuation.invokeOnCancellation { prompt.cancelAuthentication() }
        }

    private companion object {
        const val AndroidKeyStore = "AndroidKeyStore"
        const val KeyAlias = "ledgerline.session-token"
        const val Transformation = "AES/GCM/NoPadding"
        const val StoredToken = "token"
        const val StoredIv = "iv"
    }
}
