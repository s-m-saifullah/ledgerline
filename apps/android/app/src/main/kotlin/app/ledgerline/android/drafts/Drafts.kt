package app.ledgerline.android.drafts

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

private val DraftJson = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
}

/**
 * What a sheet or the editor holds, kept in the activity's saved state so that Android ending the app in the background
 * does not lose what was typed (WP-18b). It is text in a handle the system keeps for this one activity: nothing is written
 * to the phone's storage by the app, and it is not part of a backup. A draft that cannot be read (written by another
 * version of the app) is dropped, never crashed on.
 */
class Draft<T>(private val handle: SavedStateHandle, private val key: String, private val serializer: KSerializer<T>) {
    fun load(): T? = handle.get<String>(key)?.let { text ->
        try {
            DraftJson.decodeFromString(serializer, text)
        } catch (_: Exception) {
            null
        }
    }

    /** Keeps [value]; null forgets the draft. */
    fun save(value: T?) {
        if (value == null) handle.remove<String>(key) else handle[key] = DraftJson.encodeToString(serializer, value)
    }
}

/** The retry keys of a sheet's writes (see `WriteKeys`), kept beside its form. */
fun keysDraft(handle: SavedStateHandle, key: String = "keys"): Draft<Map<String, String>> =
    Draft(handle, key, MapSerializer(String.serializer(), String.serializer()))

/**
 * Keeps [draft] in step with [sheet]: every change is saved, and a closed sheet forgets it. The collector runs where the
 * change is made (unconfined), so the draft is written the moment the form changes, not a moment later: Android may end the
 * app at any time.
 */
fun <U, D> ViewModel.keepDraft(draft: Draft<D>, sheet: StateFlow<U?>, toDraft: (U) -> D) {
    viewModelScope.launch(Dispatchers.Unconfined) { sheet.collect { draft.save(it?.let(toDraft)) } }
}
