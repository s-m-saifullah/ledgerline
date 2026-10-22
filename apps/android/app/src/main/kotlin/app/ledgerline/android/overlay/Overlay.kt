package app.ledgerline.android.overlay

import app.ledgerline.android.mirror.TransactionRow
import app.ledgerline.android.outbox.OutboxRow
import app.ledgerline.api.ApiJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long

/** An entry as the owner should see it: the mirror's row with the changes not yet sent laid over it. */
data class ShownEntry(
    val id: String,
    val accountId: String,
    val categoryId: String?,
    val kind: String,
    val isSplit: Boolean,
    val date: String,
    val time: String?,
    val amount: Long,
    val currency: String,
    val payee: String?,
    val note: String?,
    val status: String,
    val tagIds: List<String>,
    val createdAt: String,
    val transferId: String?,
    /** True when a change to it is still waiting to be sent. */
    val unsent: Boolean,
    /** Set on mirrored rows: the parts the phone cannot edit (fees, bonuses, client payments, imports). */
    val linked: Boolean = false,
)

fun TransactionRow.shown(tagIds: List<String>) = ShownEntry(
    id = id,
    accountId = accountId,
    categoryId = categoryId,
    kind = kind,
    isSplit = isSplit,
    date = date,
    time = time,
    amount = amount,
    currency = currency,
    payee = payee,
    note = note,
    status = status,
    tagIds = tagIds,
    createdAt = createdAt,
    transferId = transferId,
    unsent = false,
    linked = relatedTransferId != null || feeTransferId != null || tipPaymentId != null ||
        receivablePaymentId != null || receivableId != null,
)

/** The id a leg of a transfer made on the phone has until the server gives it one. */
fun unsentLegId(transferId: String, leg: String) = "$transferId:$leg"

/**
 * Lays the pending changes of the outbox over the mirror (ADR 0043, slice 4). Pure: [mirror] holds the live mirrored
 * entries the changes touch (a transfer's two legs included), [changes] the pending outbox rows in the order they were
 * made. The result has one value per entry the changes touch: the entry as it will be once sent, or null when it is
 * being deleted. Superseded and rejected changes are not in [changes]: the server's version is shown for those.
 */
object Overlay {
    fun apply(mirror: List<ShownEntry>, changes: List<OutboxRow>): Map<String, ShownEntry?> {
        val shown = LinkedHashMap<String, ShownEntry?>()
        mirror.forEach { shown[it.id] = it }
        for (change in changes) {
            val body = ApiJson.parseToJsonElement(change.body).jsonObject
            when (change.type) {
                "transaction.create" -> shown[change.entityId] = newEntry(change, body)
                "transaction.update" -> shown[change.entityId]?.let { shown[change.entityId] = edited(it, body) }
                "transaction.delete" -> if (change.entityId in shown) shown[change.entityId] = null
                "transfer.create" -> newLegs(change, body).forEach { shown[it.id] = it }
                "transfer.update" -> legsOf(shown, change.entityId).forEach { leg -> shown[leg.id] = editedLeg(leg, body) }
                "transfer.delete" -> legsOf(shown, change.entityId).forEach { leg -> shown[leg.id] = null }
            }
        }
        return shown
    }

    private fun legsOf(shown: Map<String, ShownEntry?>, transferId: String) =
        shown.values.filterNotNull().filter { it.transferId == transferId && it.kind == "transfer" }

    private fun newEntry(change: OutboxRow, body: JsonObject): ShownEntry {
        val money = body.getValue("amount").jsonObject
        return ShownEntry(
            id = change.entityId,
            accountId = body.text("accountId")!!,
            categoryId = body.text("categoryId"),
            kind = body.text("kind")!!,
            isSplit = (body["splits"] as? JsonArray)?.isNotEmpty() == true,
            date = body.text("date")!!,
            time = body.text("time"),
            amount = money.getValue("amount").jsonPrimitive.long,
            currency = money.text("currency")!!,
            payee = body.text("payee"),
            note = body.text("note"),
            status = body.text("status") ?: "cleared",
            tagIds = body.ids("tagIds").orEmpty(),
            createdAt = change.editedAt,
            transferId = null,
            unsent = true,
        )
    }

    /** An entry update carries only the fields it changes. */
    private fun edited(entry: ShownEntry, body: JsonObject): ShownEntry {
        val money = body["amount"]?.takeIf { it != JsonNull }?.jsonObject
        return entry.copy(
            accountId = body.text("accountId") ?: entry.accountId,
            categoryId = if ("categoryId" in body) body.text("categoryId") else entry.categoryId,
            kind = body.text("kind") ?: entry.kind,
            date = body.text("date") ?: entry.date,
            time = if ("time" in body) body.text("time") else entry.time,
            amount = money?.getValue("amount")?.jsonPrimitive?.long ?: entry.amount,
            currency = money?.text("currency") ?: entry.currency,
            payee = if ("payee" in body) body.text("payee") else entry.payee,
            note = if ("note" in body) body.text("note") else entry.note,
            status = body.text("status") ?: entry.status,
            tagIds = body.ids("tagIds") ?: entry.tagIds,
            unsent = true,
        )
    }

    private fun newLegs(change: OutboxRow, body: JsonObject): List<ShownEntry> {
        val money = body.getValue("amount").jsonObject
        val amount = money.getValue("amount").jsonPrimitive.long
        val leg = ShownEntry(
            id = "",
            accountId = "",
            categoryId = null,
            kind = "transfer",
            isSplit = false,
            date = body.text("date")!!,
            time = body.text("time"),
            amount = 0,
            currency = money.text("currency")!!,
            payee = null,
            note = body.text("note"),
            status = "cleared",
            tagIds = body.ids("tagIds").orEmpty(),
            createdAt = change.editedAt,
            transferId = change.entityId,
            unsent = true,
        )
        return listOf(
            leg.copy(id = unsentLegId(change.entityId, "from"), accountId = body.text("fromAccountId")!!, amount = -amount),
            leg.copy(id = unsentLegId(change.entityId, "to"), accountId = body.text("toAccountId")!!, amount = amount),
        )
    }

    /** A transfer update carries every field; the outgoing leg is the negative one. */
    private fun editedLeg(leg: ShownEntry, body: JsonObject): ShownEntry {
        val money = body.getValue("amount").jsonObject
        val amount = money.getValue("amount").jsonPrimitive.long
        val outgoing = leg.amount < 0
        return leg.copy(
            accountId = body.text(if (outgoing) "fromAccountId" else "toAccountId")!!,
            amount = if (outgoing) -amount else amount,
            currency = money.text("currency")!!,
            date = body.text("date")!!,
            time = body.text("time"),
            note = body.text("note"),
            tagIds = body.ids("tagIds") ?: leg.tagIds,
            unsent = true,
        )
    }

    private fun JsonObject.text(name: String): String? = (this[name] as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull

    private fun JsonObject.ids(name: String): List<String>? =
        (this[name] as? JsonArray)?.map { it.jsonPrimitive.content }
}

/** How much each account's balance changes once the unsent changes are applied (cleared entries only). */
fun balanceChanges(mirror: List<ShownEntry>, shown: Map<String, ShownEntry?>): Map<String, Long> {
    val change = mutableMapOf<String, Long>()
    for (entry in mirror) if (entry.status == "cleared") change.merge(entry.accountId, -entry.amount, Long::plus)
    for (entry in shown.values.filterNotNull()) if (entry.status == "cleared") change.merge(entry.accountId, entry.amount, Long::plus)
    return change.filterValues { it != 0L }
}

/** The order of the entries list (the same as the SQL list): newest date, then time (none last), then creation. */
val NewestFirst: Comparator<ShownEntry> =
    compareByDescending<ShownEntry> { it.date }
        .thenBy { it.time == null }
        .thenByDescending { it.time }
        .thenByDescending { it.createdAt }
        .thenByDescending { it.id }
