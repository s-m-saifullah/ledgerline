package app.ledgerline.android.mirror

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.ledgerline.android.outbox.OutboxRow
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * A phone that has version 1 (the read-only mirror) upgrades to version 2 (the outbox) without losing a row, and
 * Room accepts the result as exactly the schema it expects. Version 1 is built from its exported schema file.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class MigrationTest {
    private val schemas = File("schemas/app.ledgerline.android.mirror.MirrorDatabase")

    private fun createVersion1(path: File) {
        val database = Json.parseToJsonElement(File(schemas, "1.json").readText()).jsonObject.getValue("database").jsonObject
        SQLiteDatabase.openOrCreateDatabase(path, null).use { db ->
            for (entity in database.getValue("entities").jsonArray.map { it.jsonObject }) {
                val table = entity.getValue("tableName").jsonPrimitive.content
                db.execSQL(entity.getValue("createSql").jsonPrimitive.content.replace("\${TABLE_NAME}", table))
                entity["indices"]?.jsonArray?.forEach {
                    db.execSQL(it.jsonObject.getValue("createSql").jsonPrimitive.content.replace("\${TABLE_NAME}", table))
                }
            }
            database.getValue("setupQueries").jsonArray.forEach { db.execSQL(it.jsonPrimitive.content) }
            db.execSQL(
                "INSERT INTO accounts VALUES ('l', 'a1', 3, 'c', 'u', NULL, 'Checking', 'bank', 'USD', 9007199254740991, 'USD', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)",
            )
            db.execSQL("INSERT INTO sync_cursors VALUES ('l', 'cursor-1', '2026-10-22T10:00:00.000Z')")
            db.version = 1
        }
    }

    @Test
    fun version1UpgradesToTheOutboxKeepingEveryRow() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val path = context.getDatabasePath("migration-test.db").apply { parentFile?.mkdirs(); delete() }
        createVersion1(path)

        val upgraded = Room.databaseBuilder(context, MirrorDatabase::class.java, path.absolutePath).allowMainThreadQueries().build()
        val account = upgraded.dao().allAccounts("l").single()
        assertEquals("Checking", account.name)
        assertEquals(9_007_199_254_740_991L, account.openingAmount)
        assertEquals("cursor-1", upgraded.dao().cursor("l")?.cursor)
        upgraded.outbox().insert(
            OutboxRow("m", "l", 1, "transaction", "create", "m", null, "t", "{}", false, OutboxRow.Pending, null, null, null),
        )
        assertEquals(1, upgraded.outbox().all().size)
        upgraded.close()
    }
}
