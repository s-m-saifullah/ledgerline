package app.ledgerline.android.server

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** Where the owner's server lives. Kept only on this phone. */
interface ServerAddressStore {
    /** The saved origin, or null before the first run. */
    val origin: Flow<String?>

    suspend fun save(origin: String)

    suspend fun clear()
}

private val Context.settingsStore: DataStore<Preferences> by preferencesDataStore(name = "settings")
private val OriginKey = stringPreferencesKey("server_origin")

@Singleton
class DataStoreServerAddressStore @Inject constructor(
    @ApplicationContext private val context: Context,
) : ServerAddressStore {
    override val origin: Flow<String?> = context.settingsStore.data.map { it[OriginKey] }

    override suspend fun save(origin: String) {
        context.settingsStore.edit { it[OriginKey] = origin }
    }

    override suspend fun clear() {
        context.settingsStore.edit { it.remove(OriginKey) }
    }
}
