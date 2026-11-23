package app.ledgerline.api

import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.HTTP
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query
import java.lang.reflect.Method
import java.lang.reflect.ParameterizedType
import java.lang.reflect.Type
import java.lang.reflect.WildcardType

/**
 * Every method of [LedgerlineApi] against `docs/openapi.json`, read from the interface itself (the types are checked
 * by [ContractTest], but a path, a verb, a query name or a header typed wrong in the interface is invisible to it). For
 * each method: the verb and path are in the document; the path variables are the document's; every `@Query` is a
 * parameter of that operation and every required one is sent; `Idempotency-Key` is sent exactly when the operation takes
 * one; a `@Body` is there exactly when the operation has a request body, and its type, and the type returned, match the
 * document's schemas. A method added to the interface is checked at once, with no case to remember to write.
 *
 * Not covered here: the sign-in routes (they belong to the sign-in library, not the document; `AuthClientTest` covers
 * what the app sends and reads) and the routes the phone does not call.
 */
class RoutesContractTest {
    private class Route(val method: Method, val verb: String, val path: String, val hasBody: Boolean)

    private val verbs = listOf("get", "post", "put", "patch", "delete")

    private fun routes(): List<Route> = LedgerlineApi::class.java.declaredMethods.map { method ->
        method.getAnnotation(GET::class.java)?.let { Route(method, "get", "/" + it.value, false) }
            ?: method.getAnnotation(POST::class.java)?.let { Route(method, "post", "/" + it.value, true) }
            ?: method.getAnnotation(PUT::class.java)?.let { Route(method, "put", "/" + it.value, true) }
            ?: method.getAnnotation(PATCH::class.java)?.let { Route(method, "patch", "/" + it.value, true) }
            ?: method.getAnnotation(DELETE::class.java)?.let { Route(method, "delete", "/" + it.value, false) }
            ?: method.getAnnotation(HTTP::class.java)?.let { Route(method, it.method.lowercase(), "/" + it.path, it.hasBody) }
            ?: error("${method.name} has no HTTP annotation")
    }.sortedBy { it.method.name }

    private fun placeholders(path: String) = Regex("\\{(\\w+)}").findAll(path).map { it.groupValues[1] }.toList()

    /** The document's path this route is: the same, or the same with a path variable of the document written out (loans/lend). */
    private fun operationOf(route: Route): Triple<String, JsonObject, Map<String, String>>? {
        val mine = route.path.split("/")
        val candidates = SchemaContract.paths.entries.mapNotNull { (docPath, item) ->
            val operation = item.jsonObject[route.verb]?.jsonObject ?: return@mapNotNull null
            val theirs = docPath.split("/")
            if (theirs.size != mine.size) return@mapNotNull null
            val written = mutableMapOf<String, String>()
            val fits = mine.indices.all { i ->
                val a = mine[i]
                val b = theirs[i]
                when {
                    a == b -> true
                    b.startsWith("{") && !a.startsWith("{") -> { written[b.trim('{', '}')] = a; true }
                    else -> false
                }
            }
            if (fits) Triple(docPath, operation, written.toMap()) else null
        }
        // The path with the fewest variables written out is the closest one.
        return candidates.minByOrNull { it.third.size }
    }

    private fun parameters(operation: JsonObject, kind: String): List<JsonObject> =
        (operation["parameters"] as? JsonArray).orEmpty().map { it.jsonObject }.filter { it["in"]!!.jsonPrimitive.content == kind }

    private fun JsonObject.str(key: String) = this[key]!!.jsonPrimitive.content

    private fun bodyType(route: Route): Type? =
        route.method.parameterAnnotations.indices.firstOrNull { i -> route.method.parameterAnnotations[i].any { it is Body } }
            ?.let { route.method.genericParameterTypes[it] }

    /** What a suspend method returns: the type argument of its last (Continuation) parameter. */
    private fun returnType(route: Route): Type {
        val continuation = route.method.genericParameterTypes.last() as ParameterizedType
        val argument = continuation.actualTypeArguments[0]
        return if (argument is WildcardType) argument.lowerBounds[0] else argument
    }

    /** A schema that is a choice (the loan moves share one path) is matched when the type is one of its alternatives; otherwise the closest one's differences are given. */
    private fun differences(descriptor: SerialDescriptor, schema: JsonObject, at: String, request: Boolean): List<String> {
        val choice = schema["anyOf"]?.jsonArray?.map { it.jsonObject }
        if (choice == null) return SchemaContract.differences(descriptor, schema, at, request)
        val each = choice.map { SchemaContract.differences(descriptor, it, at, request) }
        return if (each.any { it.isEmpty() }) emptyList() else each.minBy { it.size }
    }

    private fun check(route: Route): List<String> {
        val name = route.method.name
        val found = operationOf(route) ?: return listOf("$name: ${route.verb.uppercase()} ${route.path} is not in the contract")
        val (docPath, operation, written) = found
        val problems = mutableListOf<String>()
        fun problem(text: String) = problems.add("$name (${route.verb.uppercase()} $docPath): $text")

        // Path variables: the document's, less the ones the phone writes out in the path.
        val mine = route.method.parameterAnnotations.flatMap { it.toList() }.filterIsInstance<Path>().map { it.value }.sorted()
        val theirs = placeholders(docPath).filter { it !in written }.sorted()
        if (mine != theirs) problem("path variables $mine, the contract has $theirs")
        for ((variable, literal) in written) {
            val allowed = parameters(operation, "path").first { it.str("name") == variable }["schema"]!!.jsonObject["enum"]?.jsonArray?.map { it.jsonPrimitive.content }
            if (allowed == null || literal !in allowed) problem("\"$literal\" is not one of the values of {$variable}: $allowed")
        }

        // Queries: only the contract's, and every required one.
        val queries = route.method.parameterAnnotations.flatMap { it.toList() }.filterIsInstance<Query>().map { it.value }
        val documented = parameters(operation, "query")
        for (query in queries) if (documented.none { it.str("name") == query }) problem("sends the query \"$query\", which the contract does not have")
        for (query in documented) if (query["required"]?.jsonPrimitive?.boolean == true && query.str("name") !in queries) problem("does not send the required query \"${query.str("name")}\"")

        // Headers: Idempotency-Key exactly when the operation takes one, nothing else.
        val headers = route.method.parameterAnnotations.flatMap { it.toList() }.filterIsInstance<Header>().map { it.value.lowercase() }
        val wanted = parameters(operation, "header").map { it.str("name").lowercase() }
        if (headers.sorted() != wanted.sorted()) problem("headers $headers, the contract has $wanted")

        // The body going out.
        val body = bodyType(route)
        val requestBody = operation["requestBody"]?.jsonObject
        if ((body != null) != (requestBody != null)) {
            problem(if (body != null) "sends a body, the contract has none" else "sends no body, the contract has one")
        } else if (body != null && requestBody != null) {
            val schema = requestBody["content"]!!.jsonObject["application/json"]?.jsonObject?.get("schema")?.jsonObject
            if (schema == null) problem("the contract's body is not JSON") else {
                differences(serializer(body).descriptor, schema, "$name body", request = true).forEach { problem(it) }
            }
        }

        // Every 2xx answer that has a JSON body is the type returned.
        val answers = operation["responses"]!!.jsonObject.filterKeys { it.startsWith("2") }
        val returned = returnType(route)
        val withBody = answers.filterValues { it.jsonObject["content"] != null }
        if (withBody.isEmpty()) {
            if (returned != Unit::class.java && returned.typeName != "kotlin.Unit") problem("returns ${returned.typeName}, the contract has no answer body")
        }
        for ((status, response) in withBody) {
            val schema = response.jsonObject["content"]!!.jsonObject["application/json"]?.jsonObject?.get("schema")?.jsonObject ?: continue
            differences(serializer(returned).descriptor, schema, "$name $status", request = false).forEach { problem(it) }
        }
        return problems
    }

    @Test
    fun everyRouteOfTheInterfaceIsWhatTheContractSays() {
        assertEquals(emptyList<String>(), routes().flatMap { check(it) })
    }

    @Test
    fun theTestSeesEveryRouteOfTheInterface() {
        val routes = routes()
        assertTrue("only ${routes.size} routes were read", routes.size >= 30)
        // Spot checks that the reading itself is right, so a broken reader cannot pass everything.
        assertTrue(routes.any { it.method.name == "lendLoan" && it.path.endsWith("/loans/lend") })
        assertTrue(routes.any { it.method.name == "deleteBudget" && it.verb == "delete" && it.hasBody })
        assertTrue(routes.all { verbs.contains(it.verb) })
    }

    @Test
    fun aRouteThatIsNotInTheContractIsReported() {
        val fake = Route(LedgerlineApi::class.java.declaredMethods.first(), "get", "/api/v1/nothing/here", false)
        assertTrue(check(fake).single().contains("is not in the contract"))
    }
}
