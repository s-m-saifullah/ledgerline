package app.ledgerline.android.settings

import android.content.Context
import androidx.core.content.edit
import app.ledgerline.android.mirror.EntryFilters
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Inject
import javax.inject.Singleton

/** Filters kept on the phone for a chosen time, with when they last changed. */
data class SavedFilters(val filters: EntryFilters, val changedAtMillis: Long)

/**
 * Where the Transactions filters wait while the app is closed (only when the owner chose to keep them for a time). The
 * phone's private storage, like the mirror: the app allows no backups, and signing out deletes it.
 */
interface FilterStore {
    fun load(): SavedFilters?

    fun save(saved: SavedFilters)

    fun clear()
}

@Singleton
class PrefsFilterStore @Inject constructor(@ApplicationContext context: Context) : FilterStore {
    private val prefs = context.getSharedPreferences("entry-filters", Context.MODE_PRIVATE)

    override fun load(): SavedFilters? {
        if (!prefs.contains("changedAt")) return null
        val filters = EntryFilters(
            text = prefs.getString("text", "").orEmpty(),
            accountId = prefs.getString("accountId", null),
            categoryId = prefs.getString("categoryId", null),
            includeSubcategories = prefs.getBoolean("includeSubcategories", true),
            tagId = prefs.getString("tagId", null),
            from = prefs.getString("from", null),
            to = prefs.getString("to", null),
            kind = prefs.getString("kind", null),
            status = prefs.getString("status", null),
        )
        return SavedFilters(filters, prefs.getLong("changedAt", 0))
    }

    override fun save(saved: SavedFilters) = prefs.edit(commit = true) {
        val filters = saved.filters
        putString("text", filters.text)
        putString("accountId", filters.accountId)
        putString("categoryId", filters.categoryId)
        putBoolean("includeSubcategories", filters.includeSubcategories)
        putString("tagId", filters.tagId)
        putString("from", filters.from)
        putString("to", filters.to)
        putString("kind", filters.kind)
        putString("status", filters.status)
        putLong("changedAt", saved.changedAtMillis)
    }

    override fun clear() = prefs.edit(commit = true) { clear() }
}

@Module
@InstallIn(SingletonComponent::class)
abstract class FilterStoreModule {
    @Binds
    abstract fun bindFilterStore(store: PrefsFilterStore): FilterStore
}
