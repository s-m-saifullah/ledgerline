package app.ledgerline.android.overlay

import app.ledgerline.android.outbox.OutboxRow
import app.ledgerline.api.ApiJson
import app.ledgerline.api.SyncTransaction
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long

enum class AttentionReason { ChangedElsewhere, DeletedElsewhere, Rejected }

/** A change the server did not take, described for the Needs your attention list. */
data class AttentionItem(
    val id: String,
    /** transaction.create, transfer.update and so on. */
    val type: String,
    val payee: String?,
    val amount: Long?,
    val currency: String?,
    val reason: AttentionReason,
    /** The server's explanation for a rejected change. */
    val detail: String?,
    /** Keep mine is possible: the change lost to an edit (not a delete) on another device. */
    val canKeepMine: Boolean,
)

fun attentionItem(row: OutboxRow): AttentionItem {
    val body = ApiJson.parseToJsonElement(row.body).jsonObject
    val serverRows = row.serverRows?.let { ApiJson.decodeFromString(ListSerializer(SyncTransaction.serializer()), it) }.orEmpty()
    val server = if (row.kind == "transaction") {
        serverRows.find { it.id == row.entityId }
    } else {
        serverRows.find { it.transferId == row.entityId && it.kind == "transfer" && it.amount.amount < 0 }
    }
    val money = (body["amount"] as? JsonObject)
    val reason = when {
        row.state == OutboxRow.Rejected -> AttentionReason.Rejected
        server?.deletedAt != null -> AttentionReason.DeletedElsewhere
        else -> AttentionReason.ChangedElsewhere
    }
    return AttentionItem(
        id = row.id,
        type = row.type,
        payee = (body["payee"] as? JsonPrimitive)?.contentOrNull ?: server?.payee,
        amount = money?.get("amount")?.jsonPrimitive?.long ?: server?.amount?.amount,
        currency = (money?.get("currency") as? JsonPrimitive)?.contentOrNull ?: server?.amount?.currency,
        reason = reason,
        detail = row.problemDetail ?: row.problemTitle,
        canKeepMine = reason == AttentionReason.ChangedElsewhere && row.action != "create" && server != null,
    )
}
