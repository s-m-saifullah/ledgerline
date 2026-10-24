package app.ledgerline.android.mirror

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.ledgerline.android.overlay.LedgerView
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The search ignores capital and small letters for every letter, not only A to Z (SQLite folds only those). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class EntrySearchTest {
    private lateinit var database: MirrorDatabase
    private val ledger = "ledger-a"

    @Before
    fun open() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, MirrorDatabase::class.java).allowMainThreadQueries().build()
        MirrorStore(database).replaceAll(
            ledger,
            changes(
                accounts = listOf(account(1)),
                transactions = listOf(
                    entry(10, payee = "Café au lait").copy(date = "2026-10-01"),
                    entry(11, payee = "ÉCLAIR shop").copy(date = "2026-10-02"),
                    entry(12, payee = "Bäckerei Müller").copy(date = "2026-10-03"),
                    entry(13, payee = "Plain").copy(date = "2026-10-04", note = "Привет, МИР"),
                    entry(14, payee = "Ordinary Cafe").copy(date = "2026-10-05"),
                ),
            ).toRows(ledger),
            "c",
            Stamp,
        )
    }

    @After
    fun close() = database.close()

    private suspend fun found(text: String): List<Int> =
        LedgerView(database.reads(), database.dao(), database.outbox()).entries(ledger, 10, EntryFilters(text = text)).first()
            .map { shown -> (10..14).first { id(it) == shown.line.id } }

    @Test
    fun capitalAndSmallLettersMatchWhateverTheLanguage() = runBlocking {
        assertEquals(listOf(10), found("CAFÉ"))
        assertEquals(listOf(10), found("café"))
        assertEquals(listOf(11), found("éclair"))
        assertEquals(listOf(11), found("Éclair SHOP"))
        assertEquals(listOf(12), found("MÜLLER"))
        assertEquals(listOf(12), found("bäckerei"))
        // The note is searched too, in Cyrillic as well.
        assertEquals(listOf(13), found("привет"))
        assertEquals(listOf(13), found("мир"))
        // Plain English as before.
        assertEquals(listOf(14), found("ORDINARY"))
    }

    @Test
    fun anAccentIsPartOfTheLetterOnlyTheCaseIsIgnored() = runBlocking {
        // "cafe" finds the English cafe but not "Café": the owner asked about case, not about accents.
        assertEquals(listOf(14), found("cafe"))
    }

    @Test
    fun theMatchIsADirectCheckAsWell() {
        val filters = EntryFilters(text = "  ÉCLAIR ")
        assertTrue(filters.matchesText("une éclair", null))
        assertTrue(filters.matchesText(null, "Mon ÉCLAIR"))
        assertFalse(filters.matchesText("eclair", null))
        assertTrue(EntryFilters().matchesText(null, null))
        assertFalse(EntryFilters(text = "x").matchesText(null, null))
    }
}
