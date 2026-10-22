package app.ledgerline.android.mirror

import androidx.room.AutoMigration
import androidx.room.Database
import app.ledgerline.android.outbox.OutboxDao
import app.ledgerline.android.outbox.OutboxRow
import androidx.room.RoomDatabase

/**
 * The phone's copy of the ledger (ADR 0043) and, since version 2, the outbox of changes not yet sent. The mirror
 * tables can be refilled by a full pull; the outbox cannot, so every schema change needs a migration and a test, and
 * the database is never dropped and rebuilt.
 */
@Database(
    entities = [
        AccountRow::class, CategoryRow::class, TagRow::class, CurrencyRow::class, RateRow::class,
        TransactionRow::class, SplitRow::class, TransactionTagRow::class, SyncCursorRow::class, OutboxRow::class,
    ],
    version = 2,
    exportSchema = true,
    autoMigrations = [AutoMigration(from = 1, to = 2)],
)
abstract class MirrorDatabase : RoomDatabase() {
    abstract fun dao(): MirrorDao

    abstract fun reads(): MirrorReads

    abstract fun outbox(): OutboxDao
}
