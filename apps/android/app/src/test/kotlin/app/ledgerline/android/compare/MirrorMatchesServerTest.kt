package app.ledgerline.android.compare

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.ledgerline.android.mirror.MirrorDatabase
import app.ledgerline.android.mirror.MirrorStore
import app.ledgerline.android.mirror.PullResult
import app.ledgerline.android.mirror.PullSource
import app.ledgerline.android.mirror.SyncEngine
import app.ledgerline.android.mirror.SyncLock
import app.ledgerline.api.SessionToken
import app.ledgerline.api.SignInResult
import app.ledgerline.api.appUserAgent
import app.ledgerline.api.createClients
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * The scratch-ledger comparison (ADR 0043, slice 3): signs in to a real server, makes changes through the REST API,
 * pulls them with the app's own engine into a real Room database, and checks the mirror against what the API says:
 * every live account's balance, every live entry with its tags and split lines, and the screen query's names. Then
 * it changes and deletes rows, pulls incrementally, checks again, and checks that the incremental mirror equals a
 * fresh full pull row for row.
 *
 * Skipped unless LEDGERLINE_COMPARE_ORIGIN is set. It WRITES to the ledger, so point it only at a scratch server
 * with synthetic data, never production:
 *
 *   LEDGERLINE_COMPARE_ORIGIN=http://localhost:3101 LEDGERLINE_COMPARE_EMAIL=owner@example.com \
 *   LEDGERLINE_COMPARE_PASSWORD=... LEDGERLINE_COMPARE_TOTP=<secret or otpauth:// URI, if two-factor is on> \
 *   ./gradlew :app:testDebugUnitTest --tests '*MirrorMatchesServerTest' --rerun
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class MirrorMatchesServerTest {
    private val origin: String? = System.getenv("LEDGERLINE_COMPARE_ORIGIN")?.trimEnd('/')
    private val json = Json { ignoreUnknownKeys = true }
    private val http = OkHttpClient.Builder().followRedirects(false).build()
    private lateinit var token: SessionToken
    private lateinit var ledgerId: String

    @Test
    fun theMirrorMatchesTheServer() = runBlocking {
        assumeTrue("set LEDGERLINE_COMPARE_ORIGIN to run the scratch comparison", origin != null)
        withContext(Dispatchers.IO) { compare() }
    }

    private suspend fun compare() {
        val base = checkNotNull(origin)
        token = signIn(base)
        val clients = createClients(base, appUserAgent("compare", "jvm"), { token.value })
        ledgerId = clients.api.ledgers().items.first().id
        val source = PullSource { ledger, cursor, limit -> clients.api.sync(ledger, cursor, limit) }

        // Seed: two accounts, categories, tags, entries (one pending, one split), and a transfer.
        val run = UUID.randomUUID().toString().take(6)
        val today = LocalDate.now().toString()
        val checking = post("accounts", obj { put("name", "Compare $run checking"); put("type", "bank"); put("openingBalance", money(100_000)) })
        val cash = post("accounts", obj { put("name", "Compare $run cash"); put("type", "cash"); put("openingBalance", money(2_500)) })
        val food = post("categories", obj { put("name", "Compare $run food"); put("kind", "expense") })
        val fun_ = post("categories", obj { put("name", "Compare $run fun"); put("kind", "expense") })
        val salary = post("categories", obj { put("name", "Compare $run salary"); put("kind", "income") })
        val tagA = post("tags", obj { put("name", "compare-$run-a") })
        val tagB = post("tags", obj { put("name", "compare-$run-b") })
        val grocer = post("transactions", entry(checking.id, food.id, "expense", -4_599, "Grocer") { put("tagIds", ids(tagA.id, tagB.id)) })
        val pay = post("transactions", entry(checking.id, salary.id, "income", 250_000, "Payroll"))
        val pending = post("transactions", entry(checking.id, food.id, "expense", -1_234, "Pending shop") { put("status", "pending") })
        post(
            "transactions",
            obj {
                put("accountId", checking.id); put("categoryId", JsonNull); put("kind", "expense"); put("date", today)
                put("amount", money(-3_000)); put("payee", "Split shop")
                put(
                    "splits",
                    buildJsonArray {
                        add(obj { put("categoryId", food.id); put("amount", money(-2_000)) })
                        add(obj { put("categoryId", fun_.id); put("amount", money(-1_000)) })
                    },
                )
            },
        )
        val transfer = post(
            "transfers",
            obj { put("fromAccountId", checking.id); put("toAccountId", cash.id); put("amount", money(5_000)); put("date", today) },
        )

        val context = ApplicationProvider.getApplicationContext<Context>()
        val first = Room.inMemoryDatabaseBuilder(context, MirrorDatabase::class.java).allowMainThreadQueries().build()
        val engine = SyncEngine(source, MirrorStore(first), SyncLock())
        assertEquals(true, (engine.pull(ledgerId) as PullResult.Updated).fullRefresh)
        checkAgainstApi(first, "after the first full pull")

        // Change things: edit an entry (amount, payee, one tag removed), delete one, clear the pending one, add an
        // entry, rename an account (the names are joined on the phone), and delete the transfer (two tombstones).
        patch("transactions/${grocer.id}", obj {
            put("expectedVersion", grocer.version); put("amount", money(-5_099)); put("payee", "Grocer two"); put("tagIds", ids(tagA.id))
        })
        delete("transactions/${pay.id}", obj { put("expectedVersion", pay.version) })
        patch("transactions/${pending.id}", obj { put("expectedVersion", pending.version); put("status", "cleared") })
        post("transactions", entry(cash.id, fun_.id, "expense", -700, "Cafe") { put("tagIds", ids(tagB.id)) })
        patch("accounts/${cash.id}", obj { put("expectedVersion", cash.version); put("name", "Compare $run wallet") })
        delete("transfers/${transfer.id}", obj { put("expectedVersion", transfer.version) })

        assertEquals(false, (engine.pull(ledgerId) as PullResult.Updated).fullRefresh)
        checkAgainstApi(first, "after an incremental pull")

        val fresh = Room.inMemoryDatabaseBuilder(context, MirrorDatabase::class.java).allowMainThreadQueries().build()
        assertEquals(true, (SyncEngine(source, MirrorStore(fresh), SyncLock()).pull(ledgerId) as PullResult.Updated).fullRefresh)
        sameRows(first, fresh)
        checkAgainstApi(fresh, "after a fresh full pull")
        first.close()
        fresh.close()
    }

    private suspend fun checkAgainstApi(db: MirrorDatabase, stage: String) {
        val dao = db.dao()
        val reads = db.reads()

        val apiAccounts = list("accounts")
        val mirrorBalances = reads.accountBalancesNow(ledgerId, includeHidden = true).associateBy { it.id }
        assertEquals("$stage: account ids", apiAccounts.map { it.id }.toSet(), mirrorBalances.keys)
        for (account in apiAccounts) {
            val mine = mirrorBalances.getValue(account.id)
            assertEquals("$stage: balance of an account", account.money("balance"), mine.balance)
            assertEquals("$stage: account name", account.text("name"), mine.name)
        }

        val apiEntries = list("transactions")
        val live = dao.allTransactions(ledgerId).filter { it.deletedAt == null }.associateBy { it.id }
        assertEquals("$stage: entry ids", apiEntries.map { it.id }.toSet(), live.keys)
        val tags = dao.allTags(ledgerId).associateBy { it.id }
        val links = dao.allTransactionTags(ledgerId).filter { it.deletedAt == null && tags[it.tagId]?.deletedAt == null }
            .groupBy({ it.transactionId }, { it.tagId })
        val splits = dao.allSplits(ledgerId).filter { it.deletedAt == null }.groupBy { it.transactionId }
        for (entry in apiEntries) {
            val mine = live.getValue(entry.id)
            assertEquals("$stage: amount", entry.money("amount"), mine.amount)
            assertEquals("$stage: account", entry.text("accountId"), mine.accountId)
            assertEquals("$stage: category", entry.text("categoryId"), mine.categoryId)
            assertEquals("$stage: kind", entry.text("kind"), mine.kind)
            assertEquals("$stage: status", entry.text("status"), mine.status)
            assertEquals("$stage: payee", entry.text("payee"), mine.payee)
            assertEquals("$stage: date", entry.text("date"), mine.date)
            assertEquals("$stage: version", entry.body["version"]!!.jsonPrimitive.int, mine.version)
            assertEquals("$stage: base amount", entry.money("baseAmount"), mine.baseAmount)
            val apiTags = entry.body["tags"]!!.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.content }.toSet()
            assertEquals("$stage: tags", apiTags, links[entry.id].orEmpty().toSet())
            val apiSplits = entry.body["splits"]!!.jsonArray.map { it.jsonObject }
                .map { Triple(it["id"]!!.jsonPrimitive.content, it["categoryId"]!!.jsonPrimitive.content, it["amount"]!!.jsonObject["amount"]!!.jsonPrimitive.long) }
                .toSet()
            assertEquals("$stage: split lines", apiSplits, splits[entry.id].orEmpty().map { Triple(it.id, it.categoryId, it.amount) }.toSet())
        }

        // The screen's own query shows every live entry, with the tag names the API gives.
        val lines = reads.entryLinesNow(ledgerId, limit = 1_000_000).associateBy { it.id }
        assertEquals("$stage: entries on screen", live.keys, lines.keys)
        for (entry in apiEntries) {
            val names = entry.body["tags"]!!.jsonArray.map { it.jsonObject["name"]!!.jsonPrimitive.content }.sortedBy { it.lowercase() }
            assertEquals("$stage: tag names on screen", names.joinToString(", ").ifEmpty { null }, lines.getValue(entry.id).tagNames)
        }
    }

    /** An incremental mirror and a fresh full pull hold the same rows, tombstones included. */
    private suspend fun sameRows(a: MirrorDatabase, b: MirrorDatabase) {
        val x = a.dao()
        val y = b.dao()
        assertEquals("accounts", x.allAccounts(ledgerId), y.allAccounts(ledgerId))
        assertEquals("categories", x.allCategories(ledgerId), y.allCategories(ledgerId))
        assertEquals("tags", x.allTags(ledgerId), y.allTags(ledgerId))
        assertEquals("currencies", x.allCurrencies(ledgerId), y.allCurrencies(ledgerId))
        assertEquals("rates", x.allRates(ledgerId), y.allRates(ledgerId))
        assertEquals("entries", x.allTransactions(ledgerId), y.allTransactions(ledgerId))
        assertEquals("split lines", x.allSplits(ledgerId), y.allSplits(ledgerId))
        assertEquals("entry tags", x.allTransactionTags(ledgerId), y.allTransactionTags(ledgerId))
    }

    // --- The server, through plain HTTP (test-only; the app's own types cover only what the app calls). ---

    private class Row(val body: JsonObject) {
        val id get() = body["id"]!!.jsonPrimitive.content
        val version get() = body["version"]!!.jsonPrimitive.int
        fun text(name: String) = body[name]?.jsonPrimitive?.contentOrNull
        fun money(name: String) = body[name]!!.jsonObject["amount"]!!.jsonPrimitive.long
    }

    private fun obj(build: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit) = buildJsonObject(build)
    private fun money(amount: Long) = obj { put("amount", amount); put("currency", "USD") }
    private fun ids(vararg values: String) = JsonArray(values.map { JsonPrimitive(it) })
    private fun entry(
        account: String,
        category: String,
        kind: String,
        amount: Long,
        payee: String,
        more: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit = {},
    ) = obj {
        put("accountId", account); put("categoryId", category); put("kind", kind); put("date", LocalDate.now().toString())
        put("amount", money(amount)); put("payee", payee); more()
    }

    private fun request(method: String, path: String, body: JsonElement?): JsonObject {
        val builder = Request.Builder()
            .url("$origin/api/v1/ledgers/$ledgerId/$path")
            .header("Authorization", "Bearer ${token.value}")
            .header("Origin", checkNotNull(origin))
        if (body != null) {
            builder.header("Idempotency-Key", UUID.randomUUID().toString())
            builder.method(method, body.toString().toRequestBody("application/json".toMediaType()))
        } else {
            builder.method(method, null)
        }
        http.newCall(builder.build()).execute().use { reply ->
            val text = reply.body.string()
            check(reply.isSuccessful) { "$method $path: ${reply.code} ${text.take(400)}" }
            return if (text.isBlank()) JsonObject(emptyMap()) else json.parseToJsonElement(text).jsonObject
        }
    }

    private fun post(path: String, body: JsonObject) = Row(request("POST", path, body))
    private fun patch(path: String, body: JsonObject) = Row(request("PATCH", path, body))
    private fun delete(path: String, body: JsonObject) = request("DELETE", path, body)

    /** Every page of a list. */
    private fun list(path: String): List<Row> {
        val rows = mutableListOf<Row>()
        var cursor: String? = null
        do {
            val page = request("GET", "$path?limit=100" + (cursor?.let { "&cursor=$it" } ?: ""), null)
            rows += page["items"]!!.jsonArray.map { Row(it.jsonObject) }
            cursor = page["nextCursor"]?.jsonPrimitive?.contentOrNull
        } while (cursor != null)
        return rows
    }

    private suspend fun signIn(base: String): SessionToken {
        val email = checkNotNull(System.getenv("LEDGERLINE_COMPARE_EMAIL")) { "LEDGERLINE_COMPARE_EMAIL is not set" }
        val password = checkNotNull(System.getenv("LEDGERLINE_COMPARE_PASSWORD")) { "LEDGERLINE_COMPARE_PASSWORD is not set" }
        val auth = createClients(base, appUserAgent("compare", "jvm"), { null }).auth
        return when (val first = auth.signIn(email, password)) {
            is SignInResult.SignedIn -> first.token
            is SignInResult.NeedsCode -> {
                val secret = checkNotNull(System.getenv("LEDGERLINE_COMPARE_TOTP")) { "two-factor is on: set LEDGERLINE_COMPARE_TOTP" }
                when (val second = auth.verifyCode(first.challenge, totp(secret), backupCode = false)) {
                    is SignInResult.SignedIn -> second.token
                    else -> error("the two-factor code was not accepted: $second")
                }
            }
            is SignInResult.Failed -> error("sign-in failed: ${first.failure}")
        }
    }

    /** RFC 6238 (SHA-1, 30 seconds, 6 digits) from a base32 secret or an otpauth:// URI. */
    private fun totp(input: String): String {
        val secret = Regex("[?&]secret=([^&]+)").find(input)?.groupValues?.get(1) ?: input
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        var buffer = 0
        var bits = 0
        val key = mutableListOf<Byte>()
        for (char in secret.uppercase().filter { it != '=' && it != ' ' }) {
            buffer = (buffer shl 5) or alphabet.indexOf(char)
            bits += 5
            if (bits >= 8) {
                key += (buffer shr (bits - 8) and 0xff).toByte()
                bits -= 8
            }
        }
        val counter = System.currentTimeMillis() / 30_000
        val message = ByteArray(8) { i -> (counter shr (56 - 8 * i) and 0xff).toByte() }
        val hash = Mac.getInstance("HmacSHA1").apply { init(SecretKeySpec(key.toByteArray(), "HmacSHA1")) }.doFinal(message)
        val offset = hash.last().toInt() and 0x0f
        val code = ((hash[offset].toInt() and 0x7f) shl 24) or ((hash[offset + 1].toInt() and 0xff) shl 16) or
            ((hash[offset + 2].toInt() and 0xff) shl 8) or (hash[offset + 3].toInt() and 0xff)
        return (code % 1_000_000).toString().padStart(6, '0')
    }
}
