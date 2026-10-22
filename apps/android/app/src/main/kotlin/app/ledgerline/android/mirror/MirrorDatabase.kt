package app.ledgerline.android.mirror

import androidx.room.Database
import androidx.room.RoomDatabase

/**
 * The phone's copy of the ledger (ADR 0043). It is a cache the server can rebuild in one full pull, so a schema change
 * may drop it (see [MirrorModule]); that stops being true when slice 4 adds an outbox of unsent entries, which needs
 * real migrations and its own tables.
 */
@Database(
    entities = [
        AccountRow::class, CategoryRow::class, TagRow::class, CurrencyRow::class, RateRow::class,
        TransactionRow::class, SplitRow::class, TransactionTagRow::class, SyncCursorRow::class,
    ],
    version = 1,
    exportSchema = true,
)
abstract class MirrorDatabase : RoomDatabase() {
    abstract fun dao(): MirrorDao

    abstract fun reads(): MirrorReads
}
