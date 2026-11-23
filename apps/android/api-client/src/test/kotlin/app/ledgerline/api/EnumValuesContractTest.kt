package app.ledgerline.api

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The words the contract lets a field hold, against the words the phone handles. The phone's types hold these fields
 * as plain strings (so an unknown word from a newer server does not break the sync), which means the type checks of
 * [ContractTest] cannot see a word added, renamed or dropped by the server. Each row below is the phone's own written
 * list for one field: the test fails when the contract's list differs, and whoever changes the contract then looks at
 * what the phone does with the word (a screen's label, a branch, the outbox) before changing the row.
 *
 * A row is the set the app handles, not only the words it names in code: a word the app deliberately treats like the
 * rest (for example "unpaid", "partlyPaid" and "paid" on a service) is still listed, so a new word is a decision.
 */
class EnumValuesContractTest {
    private val history = "/api/v1/ledgers/{ledgerId}/contacts/{contactId}/history"
    private val services = "/api/v1/ledgers/{ledgerId}/receivables"
    private val sync = "/api/v1/ledgers/{ledgerId}/sync"

    private class Field(val label: String, val schema: JsonObject, val steps: List<String>, val handled: Set<String>)

    private fun response(path: String, method: String = "get") = SchemaContract.response(path, method, "200")

    /** One step into a schema: a property, or "[]" for the items of a list; a nullable field is looked through to its first alternative that has the step. */
    private fun step(node: JsonObject, step: String): JsonObject {
        val key = if (step == "[]") "items" else step
        val direct = if (step == "[]") node["items"] else node["properties"]?.jsonObject?.get(key)
        if (direct != null) return direct.jsonObject
        val alternatives = node["anyOf"]?.jsonArray.orEmpty().map { it.jsonObject }
        return checkNotNull(alternatives.firstNotNullOfOrNull { runCatching { step(it, step) }.getOrNull() }) { "no \"$step\" in the contract here" }
    }

    /** Follows names and "[]" from a schema to the schema of one field. */
    private fun at(schema: JsonObject, vararg steps: String): JsonObject = steps.fold(schema) { node, next -> step(node, next) }

    private fun fields(): List<Field> {
        val serviceStatuses = setOf("unpaid", "partlyPaid", "paid", "writtenOff")
        val kinds = setOf("expense", "income", "transfer")
        val statuses = setOf("cleared", "pending")
        val pull = response(sync)
        val push = response(sync, "post")
        val pushBody = SchemaContract.request(sync, "post")
        return listOf(
            Field(
                "a service's history, what happened",
                response(history), listOf("items", "[]", "action"),
                setOf("created", "edited", "deleted", "restored", "writtenOff", "reopened", "paymentCreated", "paymentEdited", "paymentDeleted", "paymentRestored"),
            ),
            Field("a service's status, in its history", response(history), listOf("items", "[]", "after", "service", "status"), serviceStatuses),
            Field("a service's status, in the list", response(services), listOf("items", "[]", "status"), serviceStatuses),
            Field("a service's status, in its history, before the change", response(history), listOf("items", "[]", "before", "service", "status"), serviceStatuses),
            Field("a payment's kind, in a service's history", response(history), listOf("items", "[]", "after", "payment", "kind"), kinds),
            Field("a payment's kind, in a service's history, before the change", response(history), listOf("items", "[]", "before", "payment", "kind"), kinds),
            Field("a payment's status, in a service's history, before the change", response(history), listOf("items", "[]", "before", "payment", "status"), statuses),
            Field("a payment's status, in a service's history", response(history), listOf("items", "[]", "after", "payment", "status"), statuses),
            Field("an account's type", pull, listOf("changes", "accounts", "[]", "type"), setOf("bank", "cash", "card", "wallet", "loan", "savings")),
            Field("a category's kind", pull, listOf("changes", "categories", "[]", "kind"), setOf("income", "expense")),
            Field("an entry's kind", pull, listOf("changes", "transactions", "[]", "kind"), kinds),
            Field("an entry's status", pull, listOf("changes", "transactions", "[]", "status"), statuses),
            Field("what the server did with a pushed change", push, listOf("results", "[]", "status"), setOf("applied", "replayed", "superseded", "rejected")),
            Field(
                "what the phone asks the server to do with an entry or transfer",
                pushBody, listOf("mutations", "[]", "type"),
                setOf("transaction.create", "transaction.update", "transaction.delete", "transfer.create", "transfer.update", "transfer.delete"),
            ),
        )
    }

    private fun contractWords(field: Field): Set<String>? {
        val found = at(field.schema, *field.steps.toTypedArray())
        val list = found["enum"]?.jsonArray ?: found["anyOf"]?.jsonArray?.firstNotNullOfOrNull { it.jsonObject["enum"]?.jsonArray }
        return list?.map { it.jsonPrimitive.content }?.toSet()
    }

    @Test
    fun everyFieldHoldsTheWordsThePhoneHandles() {
        val differences = fields().mapNotNull { field ->
            val contract = contractWords(field) ?: return@mapNotNull "${field.label}: the contract has no list of words here"
            when {
                contract == field.handled -> null
                else -> {
                    val added = (contract - field.handled).sorted()
                    val gone = (field.handled - contract).sorted()
                    "${field.label}: the contract adds $added and no longer has $gone"
                }
            }
        }
        assertEquals(emptyList<String>(), differences)
    }

    @Test
    fun theRowsAreRealFields() {
        assertTrue(fields().size >= 14)
        assertTrue(fields().all { contractWords(it)?.isNotEmpty() == true })
    }
}
