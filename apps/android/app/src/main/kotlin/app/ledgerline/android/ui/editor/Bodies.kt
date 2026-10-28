package app.ledgerline.android.ui.editor

import app.ledgerline.android.overlay.ShownEntry
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** What the form holds for an expense or income, ready to send. [amount] is signed (expenses negative). */
data class EntryValues(
    val kind: String,
    val accountId: String,
    val categoryId: String?,
    val date: String,
    val amount: Long,
    val currency: String,
    val payee: String?,
    val note: String?,
    val tagIds: List<String>,
    /** "HH:mm" on [date], or null when the time is not known (the web's "Time (optional)"). */
    val time: String? = null,
    /** "cleared", or "pending" for an entry that does not change the posted balance yet (the web's Status). */
    val status: String = "cleared",
)

/** What the form holds for a transfer. [amount] is the positive amount moved. */
data class TransferValues(
    val fromAccountId: String,
    val toAccountId: String,
    val amount: Long,
    val currency: String,
    val date: String,
    val time: String?,
    val note: String?,
)

private fun money(amount: Long, currency: String) = buildJsonObject {
    put("amount", amount)
    put("currency", currency)
}

private fun ids(values: List<String>) = JsonArray(values.map { JsonPrimitive(it) })

private fun text(value: String?) = value?.let { JsonPrimitive(it) } ?: JsonNull

/** The body of `POST /transactions` for a new entry. */
fun entryCreateBody(values: EntryValues): JsonObject = buildJsonObject {
    put("accountId", values.accountId)
    put("categoryId", text(values.categoryId))
    put("kind", values.kind)
    put("date", values.date)
    put("time", text(values.time))
    put("amount", money(values.amount, values.currency))
    put("status", values.status)
    put("payee", text(values.payee))
    put("note", text(values.note))
    put("tagIds", ids(values.tagIds))
}

/** Only the fields that differ from [before], for `PATCH /transactions/{id}`; empty when nothing changed. */
fun entryChanges(before: ShownEntry, values: EntryValues): JsonObject = buildJsonObject {
    if (values.accountId != before.accountId) put("accountId", values.accountId)
    if (values.categoryId != before.categoryId) put("categoryId", text(values.categoryId))
    if (values.kind != before.kind) put("kind", values.kind)
    if (values.date != before.date) put("date", values.date)
    if (values.time != before.time) put("time", text(values.time))
    if (values.amount != before.amount || values.currency != before.currency) put("amount", money(values.amount, values.currency))
    if (values.status != before.status) put("status", values.status)
    if (values.payee != before.payee) put("payee", text(values.payee))
    if (values.note != before.note) put("note", text(values.note))
    if (values.tagIds.toSet() != before.tagIds.toSet()) put("tagIds", ids(values.tagIds))
}

/** The body of `POST /transfers`, and of `PATCH /transfers/{id}`, which replaces the whole transfer. */
fun transferBody(values: TransferValues): JsonObject = buildJsonObject {
    put("fromAccountId", values.fromAccountId)
    put("toAccountId", values.toAccountId)
    put("amount", money(values.amount, values.currency))
    put("date", values.date)
    put("time", text(values.time))
    put("note", text(values.note))
}
