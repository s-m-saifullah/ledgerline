package app.ledgerline.api

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.SerialKind
import kotlinx.serialization.descriptors.StructureKind
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.io.File

/**
 * Compares a Kotlin type with a schema of docs/openapi.json and reports every difference: a property the
 * type lacks or has extra, required against optional, nullable against not, and a whole number that is too
 * big for an Int. An empty list means the type matches the contract.
 */
object SchemaContract {
    private val document: JsonObject by lazy {
        val path = checkNotNull(System.getProperty("openapi.path")) { "openapi.path is not set" }
        Json.parseToJsonElement(File(path).readText()).jsonObject
    }

    /** The JSON schema of a response of one operation, for example ("/api/v1/ledgers", "get", "200"). */
    fun response(path: String, method: String, status: String): JsonObject {
        val paths = document["paths"]!!.jsonObject
        val operation = checkNotNull(paths[path]?.jsonObject?.get(method)?.jsonObject) { "$method $path is not in the contract" }
        val response = checkNotNull(operation["responses"]?.jsonObject?.get(status)?.jsonObject) { "$method $path has no $status" }
        return response["content"]!!.jsonObject["application/json"]!!.jsonObject["schema"]!!.jsonObject
    }

    /** The JSON schema of the request body of one operation. */
    fun request(path: String, method: String): JsonObject {
        val paths = document["paths"]!!.jsonObject
        val operation = checkNotNull(paths[path]?.jsonObject?.get(method)?.jsonObject) { "$method $path is not in the contract" }
        val body = checkNotNull(operation["requestBody"]?.jsonObject) { "$method $path has no request body" }
        return body["content"]!!.jsonObject["application/json"]!!.jsonObject["schema"]!!.jsonObject
    }

    fun component(name: String): JsonObject =
        checkNotNull(document["components"]!!.jsonObject["schemas"]!!.jsonObject[name]?.jsonObject) { "no schema $name" }

    /** [request] is true for a body the app sends, where a contract default makes a property optional. */
    fun differences(
        descriptor: SerialDescriptor,
        schema: JsonObject,
        at: String = descriptor.serialName,
        request: Boolean = false,
    ): List<String> {
        val problems = mutableListOf<String>()
        compare(descriptor, schema, at, problems, request, optionalInContract = false)
        return problems
    }

    /** `anyOf: [X, { type: null }]` and `type: ["string", "null"]` are how the contract writes a nullable value. */
    private fun unwrapNullable(schema: JsonObject): Pair<JsonObject, Boolean> {
        val types = schema["type"] as? JsonArray
        if (types != null) {
            val names = types.map { it.jsonPrimitive.content }
            val nonNull = names.filter { it != "null" }
            if (nonNull.size == 1 && nonNull.size < names.size) {
                return JsonObject(schema + ("type" to JsonPrimitive(nonNull.single()))) to true
            }
            return schema to false
        }
        val options = schema["anyOf"]?.jsonArray ?: return schema to false
        val nonNull = options.map { it.jsonObject }.filter { it["type"]?.jsonPrimitive?.contentOrNull != "null" }
        if (nonNull.size == 1 && nonNull.size < options.size) return nonNull.single() to true
        return schema to false
    }

    @OptIn(ExperimentalSerializationApi::class)
    private fun compare(
        descriptor: SerialDescriptor,
        rawSchema: JsonObject,
        at: String,
        problems: MutableList<String>,
        request: Boolean = false,
        optionalInContract: Boolean = false,
    ) {
        val (schema, nullable) = unwrapNullable(rawSchema)
        // An optional property the contract never makes null is a nullable Kotlin property with a null default: absent
        // in a reply decodes to null, and null is left out when the app sends it.
        val omittedWhenNull = optionalInContract && descriptor.isNullable && !nullable
        if (descriptor.isNullable != nullable && !omittedWhenNull) {
            problems += "$at: nullable is ${descriptor.isNullable} in Kotlin but $nullable in the contract"
        }
        when (val type = schema["type"]?.jsonPrimitive?.contentOrNull) {
            "object" -> compareObject(descriptor, schema, at, problems, request)
            "array" -> {
                if (descriptor.kind != StructureKind.LIST) {
                    problems += "$at: the contract has an array"
                } else {
                    compare(descriptor.getElementDescriptor(0), schema["items"]!!.jsonObject, "$at[]", problems, request)
                }
            }
            "string" -> {
                val values = schema["enum"]?.jsonArray?.map { it.jsonPrimitive.content }
                when {
                    descriptor.kind == SerialKind.ENUM && values != null -> {
                        val names = (0 until descriptor.elementsCount).map { descriptor.getElementName(it) }
                        if (names.toSet() != values.toSet()) problems += "$at: enum values $names differ from $values"
                    }
                    descriptor.kind != PrimitiveKind.STRING -> problems += "$at: the contract has a string"
                }
            }
            "integer" -> {
                val max = schema["maximum"]?.jsonPrimitive?.longOrNull
                val needsLong = max == null || max > Int.MAX_VALUE
                when {
                    descriptor.kind == PrimitiveKind.LONG -> Unit
                    descriptor.kind == PrimitiveKind.INT && !needsLong -> Unit
                    else -> problems += "$at: the contract has an integer up to $max, which does not fit ${descriptor.kind}"
                }
            }
            "number" -> if (descriptor.kind != PrimitiveKind.DOUBLE) problems += "$at: the contract has a number"
            "boolean" -> if (descriptor.kind != PrimitiveKind.BOOLEAN) problems += "$at: the contract has a boolean"
            else -> problems += "$at: the checker does not know the contract type '$type'"
        }
    }

    @OptIn(ExperimentalSerializationApi::class)
    private fun compareObject(descriptor: SerialDescriptor, schema: JsonObject, at: String, problems: MutableList<String>, request: Boolean) {
        // A free-form object (only `additionalProperties`) is a JSON object or map in Kotlin.
        if (schema["properties"] == null && schema["additionalProperties"] != null) {
            if (descriptor.kind != StructureKind.MAP) problems += "$at: the contract has a free-form object"
            return
        }
        if (descriptor.kind != StructureKind.CLASS) {
            problems += "$at: the contract has an object"
            return
        }
        val properties = schema["properties"]?.jsonObject ?: JsonObject(emptyMap())
        val required = (schema["required"] as? JsonArray)?.map { it.jsonPrimitive.content }?.toSet() ?: emptySet()
        val names = (0 until descriptor.elementsCount).associateBy { descriptor.getElementName(it) }
        for ((name, property) in properties) {
            val index = names[name]
            if (index == null) {
                problems += "$at.$name: in the contract but not in Kotlin"
                continue
            }
            // In a request a contract default makes the property optional; in a response the server always sends it.
            val optionalHere = name !in required || (request && property.jsonObject.containsKey("default"))
            if (!optionalHere == descriptor.isElementOptional(index)) {
                problems += "$at.$name: required is ${name in required} in the contract but Kotlin has ${if (descriptor.isElementOptional(index)) "a default" else "no default"}"
            }
            compare(descriptor.getElementDescriptor(index), property.jsonObject, "$at.$name", problems, request, optionalHere)
        }
        for (name in names.keys - properties.keys) problems += "$at.$name: in Kotlin but not in the contract"
    }
}
