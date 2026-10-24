package app.ledgerline.api

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.nullable
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/*
 * Categories (ADR 0043, categories PRs): the screen reads the mirror, but adding, editing and archiving go through the
 * normal REST API, one idempotent write each, because the offline push carries only entries and transfers (ADR 0042).
 * The contract always sends every property of a reply (absent values as null), so a reply type has no defaults.
 */

/** A category as the API replies to a write; the same fields the sync pull carries, plus the ledger. */
@Serializable
data class Category(
    val id: String,
    val ledgerId: String,
    val name: String,
    val kind: String,
    val parentId: String?,
    val icon: String?,
    val color: String?,
    val sortOrder: Long,
    val archivedAt: String?,
    val version: Int,
    val createdAt: String,
    val updatedAt: String,
)

/** `POST /ledgers/{ledgerId}/categories`: a main category when [parentId] is null, otherwise a subcategory of it. */
@Serializable
data class CreateCategory(
    val name: String,
    val kind: String,
    val parentId: String? = null,
    val icon: String? = null,
    val color: String? = null,
)

/** What an edit does to the parent: leave it, make the category a main one, or put it under another main category. */
sealed interface ParentChange {
    data object Unchanged : ParentChange

    data object MakeMain : ParentChange

    data class MoveUnder(val parentId: String) : ParentChange
}

/** Writes nothing for [ParentChange.Unchanged] (it is the property's default), `null` for a main category, an id otherwise. */
object ParentChangeSerializer : KSerializer<ParentChange> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("ParentChange", PrimitiveKind.STRING).nullable

    override fun serialize(encoder: Encoder, value: ParentChange) = when (value) {
        ParentChange.MakeMain -> encoder.encodeNull()
        is ParentChange.MoveUnder -> encoder.encodeString(value.parentId)
        ParentChange.Unchanged -> throw SerializationException("An unchanged parent is left out, never written")
    }

    override fun deserialize(decoder: Decoder): ParentChange =
        if (decoder.decodeNotNullMark()) ParentChange.MoveUnder(decoder.decodeString()) else ParentChange.MakeMain
}

/** `PATCH /ledgers/{ledgerId}/categories/{categoryId}`: only what changes is sent; the kind never changes. */
@Serializable
data class UpdateCategory(
    val expectedVersion: Int,
    val name: String? = null,
    @Serializable(with = ParentChangeSerializer::class) val parentId: ParentChange = ParentChange.Unchanged,
    // The appearance is not edited on the phone yet; null leaves it out, which the server reads as "unchanged".
    val icon: String? = null,
    val color: String? = null,
)

/** The body of archive and unarchive. */
@Serializable
data class ExpectedVersion(val expectedVersion: Int)

/** Reads an error body as the contract's problem document; null when it is anything else (a proxy's page, no body). */
fun parseProblem(body: String?): Problem? = try {
    body?.let { ApiJson.decodeFromString(Problem.serializer(), it) }
} catch (_: SerializationException) {
    null
} catch (_: IllegalArgumentException) {
    null
}
