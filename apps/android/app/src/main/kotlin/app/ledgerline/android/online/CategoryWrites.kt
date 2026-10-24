package app.ledgerline.android.online

import app.ledgerline.android.mirror.CategoryRow
import app.ledgerline.android.mirror.MirrorStore
import app.ledgerline.android.mirror.toRow
import app.ledgerline.api.CreateCategory
import app.ledgerline.api.ExpectedVersion
import app.ledgerline.api.UpdateCategory
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Adding, editing and archiving categories (ADR 0043, categories PRs). Each is one idempotent REST call with the caller's
 * key; the category the server returns goes straight into the mirror, so every list and picker shows it at once, and the
 * next pull brings the same version and changes nothing.
 */
@Singleton
class CategoryWrites @Inject constructor(private val writer: OnlineWriter, private val store: MirrorStore) {
    suspend fun create(ledgerId: String, key: String, body: CreateCategory): Written<CategoryRow> =
        keep(writer.write { createCategory(ledgerId, key, body) })

    suspend fun update(ledgerId: String, categoryId: String, key: String, body: UpdateCategory): Written<CategoryRow> =
        keep(writer.write { updateCategory(ledgerId, categoryId, key, body) })

    suspend fun archive(ledgerId: String, categoryId: String, key: String, expectedVersion: Int): Written<CategoryRow> =
        keep(writer.write { archiveCategory(ledgerId, categoryId, key, ExpectedVersion(expectedVersion)) })

    suspend fun unarchive(ledgerId: String, categoryId: String, key: String, expectedVersion: Int): Written<CategoryRow> =
        keep(writer.write { unarchiveCategory(ledgerId, categoryId, key, ExpectedVersion(expectedVersion)) })

    /** Deletes a category the phone holds at [row]'s version; once the server accepts, it is a tombstone in the mirror too. */
    suspend fun delete(ledgerId: String, row: CategoryRow, key: String): Written<Unit> {
        val result = writer.write { deleteCategory(ledgerId, row.id, key, ExpectedVersion(row.version)) }
        if (result is Written.Done) store.deleteCategory(row, java.time.Instant.now().toString())
        return result
    }

    private suspend fun keep(result: Written<app.ledgerline.api.Category>): Written<CategoryRow> = when (result) {
        is Written.Done -> {
            val row = result.value.toRow()
            store.putCategory(row)
            Written.Done(row)
        }
        Written.Offline -> Written.Offline
        is Written.Rejected -> result
        Written.Forbidden -> Written.Forbidden
        Written.Failed -> Written.Failed
    }
}
