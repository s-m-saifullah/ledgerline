package app.ledgerline.android.update

import android.content.Context
import androidx.core.content.edit
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.serialization.SerializationException
import javax.inject.Inject
import javax.inject.Singleton

/** What the update check keeps on the phone: when it last succeeded, the newer release it found, and the one dismissed. */
interface UpdateStore {
    /** Wall-clock milliseconds of the last check that reached GitHub; 0 when there has been none. */
    var lastCheckMillis: Long

    /** The newest release found; the notices work from this, so they survive closing the app. */
    var found: Release?

    /** The version code whose notices the owner dismissed; 0 when none. */
    var dismissedCode: Int
}

@Singleton
class PrefsUpdateStore @Inject constructor(@ApplicationContext context: Context) : UpdateStore {
    private val prefs = context.getSharedPreferences("update-state", Context.MODE_PRIVATE)

    override var lastCheckMillis: Long
        get() = prefs.getLong(LastCheck, 0)
        set(value) = prefs.edit(commit = true) { putLong(LastCheck, value) }

    override var found: Release?
        get() = prefs.getString(Found, null)?.let {
            try {
                UpdateJson.decodeFromString(Release.serializer(), it)
            } catch (e: SerializationException) {
                null
            }
        }
        set(value) = prefs.edit(commit = true) {
            if (value == null) remove(Found) else putString(Found, UpdateJson.encodeToString(Release.serializer(), value))
        }

    override var dismissedCode: Int
        get() = prefs.getInt(Dismissed, 0)
        set(value) = prefs.edit(commit = true) { putInt(Dismissed, value) }

    private companion object {
        const val LastCheck = "lastCheck"
        const val Found = "found"
        const val Dismissed = "dismissed"
    }
}
