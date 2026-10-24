package app.ledgerline.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Every API type the app uses must match docs/openapi.json, so a change to the API breaks the build here. */
class ContractTest {
    private fun assertMatches(problems: List<String>) = assertEquals(emptyList<String>(), problems)

    @Test
    fun categoryReplyMatches() = assertMatches(
        SchemaContract.differences(
            Category.serializer().descriptor,
            SchemaContract.response("/api/v1/ledgers/{ledgerId}/categories", "post", "201"),
        ),
    )

    @Test
    fun everyCategoryWriteReturnsTheSameShape() {
        for ((path, status) in listOf(
            "/api/v1/ledgers/{ledgerId}/categories/{categoryId}" to "200",
            "/api/v1/ledgers/{ledgerId}/categories/{categoryId}/archive" to "200",
            "/api/v1/ledgers/{ledgerId}/categories/{categoryId}/unarchive" to "200",
        )) {
            val method = if (path.endsWith("{categoryId}")) "patch" else "post"
            assertMatches(SchemaContract.differences(Category.serializer().descriptor, SchemaContract.response(path, method, status)))
        }
    }

    @Test
    fun categoryRequestsMatch() {
        assertMatches(
            SchemaContract.differences(
                CreateCategory.serializer().descriptor,
                SchemaContract.request("/api/v1/ledgers/{ledgerId}/categories", "post"),
                request = true,
            ),
        )
        assertMatches(
            SchemaContract.differences(
                UpdateCategory.serializer().descriptor,
                SchemaContract.request("/api/v1/ledgers/{ledgerId}/categories/{categoryId}", "patch"),
                request = true,
            ),
        )
        assertMatches(
            SchemaContract.differences(
                ExpectedVersion.serializer().descriptor,
                SchemaContract.request("/api/v1/ledgers/{ledgerId}/categories/{categoryId}", "delete"),
                request = true,
            ),
        )
        for (action in listOf("archive", "unarchive")) {
            assertMatches(
                SchemaContract.differences(
                    ExpectedVersion.serializer().descriptor,
                    SchemaContract.request("/api/v1/ledgers/{ledgerId}/categories/{categoryId}/$action", "post"),
                    request = true,
                ),
            )
        }
    }

    @Test
    fun anEditSendsOnlyWhatChangesAndAMainCategoryIsAnExplicitNull() {
        fun body(update: UpdateCategory) = ApiJson.encodeToString(UpdateCategory.serializer(), update)
        assertEquals("""{"expectedVersion":3,"name":"Food"}""", body(UpdateCategory(3, name = "Food")))
        assertEquals("""{"expectedVersion":3,"parentId":null}""", body(UpdateCategory(3, parentId = ParentChange.MakeMain)))
        assertEquals("""{"expectedVersion":3,"name":"A","parentId":"p1"}""", body(UpdateCategory(3, "A", ParentChange.MoveUnder("p1"))))
    }

    @Test
    fun aCreateLeavesOutAParentThatIsNotThere() {
        assertEquals("""{"name":"Food","kind":"expense"}""", ApiJson.encodeToString(CreateCategory.serializer(), CreateCategory("Food", "expense")))
        assertEquals(
            """{"name":"Milk","kind":"expense","parentId":"p1"}""",
            ApiJson.encodeToString(CreateCategory.serializer(), CreateCategory("Milk", "expense", "p1")),
        )
    }

    @Test
    fun aProblemReadsItsSentenceAndTheFieldsItNames() {
        val body = """{"type":"about:blank","title":"Conflict","status":409,"detail":"A sibling category already has this name.","errors":[{"field":"name","message":"x"}],"extra":1}"""
        val problem = parseProblem(body)!!
        assertEquals(409L, problem.status)
        assertEquals("A sibling category already has this name.", problem.detail)
        assertEquals(listOf("name"), problem.errors.map { it.field })
    }

    @Test
    fun anythingThatIsNotAProblemDocumentReadsAsNull() {
        assertEquals(null, parseProblem("<html>bad gateway</html>"))
        assertEquals(null, parseProblem(null))
        assertEquals(null, parseProblem("""{"detail":"only a detail"}"""))
        assertEquals(null, parseProblem(""))
    }

    @Test
    fun healthMatches() = assertMatches(
        SchemaContract.differences(Health.serializer().descriptor, SchemaContract.response("/api/health", "get", "200")),
    )

    @Test
    fun ledgersMatch() = assertMatches(
        SchemaContract.differences(LedgerList.serializer().descriptor, SchemaContract.response("/api/v1/ledgers", "get", "200")),
    )

    @Test
    fun syncPullMatches() = assertMatches(
        SchemaContract.differences(
            SyncResponse.serializer().descriptor,
            SchemaContract.response("/api/v1/ledgers/{ledgerId}/sync", "get", "200"),
        ),
    )

    @Test
    fun aPullPageDecodesWhenEveryListIsEmptyAndWhenAServerAddsFields() {
        val json = """{"changes":{"accounts":[],"categories":[],"tags":[],"currencies":[],"exchangeRates":[],"transactions":[],"transactionSplits":[],"transactionTags":[]},"cursor":"c","hasMore":false,"serverTime":"2026-10-22T10:00:00.000Z","added":1}"""
        val page = ApiJson.decodeFromString(SyncResponse.serializer(), json)
        assertEquals("c", page.cursor)
    }

    @Test
    fun syncPushRequestMatches() = assertMatches(
        SchemaContract.differences(
            SyncPush.serializer().descriptor,
            SchemaContract.request("/api/v1/ledgers/{ledgerId}/sync", "post"),
            request = true,
        ),
    )

    @Test
    fun syncPushResponseMatches() = assertMatches(
        SchemaContract.differences(
            SyncPushResponse.serializer().descriptor,
            SchemaContract.response("/api/v1/ledgers/{ledgerId}/sync", "post", "200"),
        ),
    )

    @Test
    fun aMutationLeavesOutEmptyOptionalFieldsInsteadOfSendingNull() {
        val create = ApiJson.encodeToString(SyncMutation.serializer(), SyncMutation("m", "transaction.create", "2026-10-22T10:00:00.000Z"))
        assertEquals("""{"id":"m","type":"transaction.create","editedAt":"2026-10-22T10:00:00.000Z"}""", create)
        val update = ApiJson.encodeToString(
            SyncMutation.serializer(),
            SyncMutation("m", "transaction.update", "t", targetId = "x", baseVersion = 3, body = Json.parseToJsonElement("""{"payee":null}""").jsonObject),
        )
        assertEquals("""{"id":"m","type":"transaction.update","editedAt":"t","targetId":"x","baseVersion":3,"body":{"payee":null}}""", update)
    }

    @Test
    fun theCheckerAcceptsANullDefaultOnlyForAnOptionalProperty() {
        val optional = Json.parseToJsonElement("""{"type":"object","properties":{"targetId":{"type":"string"}},"required":[]}""").jsonObject
        assertEquals(emptyList<String>(), SchemaContract.differences(OptionalTarget.serializer().descriptor, optional))
        val required = Json.parseToJsonElement("""{"type":"object","properties":{"targetId":{"type":"string"}},"required":["targetId"]}""").jsonObject
        assertTrue(SchemaContract.differences(OptionalTarget.serializer().descriptor, required).toString(), SchemaContract.differences(OptionalTarget.serializer().descriptor, required).any { it.contains("required") })
    }

    @Test
    fun aContractDefaultMakesARequestPropertyOptionalButNotAResponseProperty() {
        val schema = Json.parseToJsonElement("""{"type":"object","properties":{"status":{"type":"string","default":"ok"}},"required":["status"]}""").jsonObject
        assertEquals(emptyList<String>(), SchemaContract.differences(HealthWithDefault.serializer().descriptor, schema, request = true))
        assertTrue(SchemaContract.differences(HealthWithDefault.serializer().descriptor, schema).single().contains("required"))
    }

    @Test
    fun theCheckerWantsAMapForAFreeFormObject() {
        val schema = Json.parseToJsonElement("""{"type":"object","properties":{"body":{"type":"object","additionalProperties":{}}},"required":["body"]}""").jsonObject
        assertTrue(SchemaContract.differences(BodyAsText.serializer().descriptor, schema).any { it.contains("free-form") })
    }

    @Test
    fun homeMatches() = assertMatches(
        SchemaContract.differences(
            HomeSummary.serializer().descriptor,
            SchemaContract.response("/api/v1/ledgers/{ledgerId}/home", "get", "200"),
        ),
    )

    @Test
    fun budgetsMatch() = assertMatches(
        SchemaContract.differences(
            BudgetMonth.serializer().descriptor,
            SchemaContract.response("/api/v1/ledgers/{ledgerId}/budgets", "get", "200"),
        ),
    )

    @Test
    fun spendingMatches() = assertMatches(
        SchemaContract.differences(
            SpendingReport.serializer().descriptor,
            SchemaContract.response("/api/v1/ledgers/{ledgerId}/reports/spending", "get", "200"),
        ),
    )

    @Test
    fun cashFlowMatches() = assertMatches(
        SchemaContract.differences(
            CashFlowReport.serializer().descriptor,
            SchemaContract.response("/api/v1/ledgers/{ledgerId}/reports/cash-flow", "get", "200"),
        ),
    )

    @Test
    fun netWorthMatches() = assertMatches(
        SchemaContract.differences(
            NetWorthReport.serializer().descriptor,
            SchemaContract.response("/api/v1/ledgers/{ledgerId}/reports/net-worth", "get", "200"),
        ),
    )

    @Test
    fun contactsMatch() = assertMatches(
        SchemaContract.differences(
            ContactList.serializer().descriptor,
            SchemaContract.response("/api/v1/ledgers/{ledgerId}/contacts", "get", "200"),
        ),
    )

    @Test
    fun contactMatches() = assertMatches(
        SchemaContract.differences(
            Contact.serializer().descriptor,
            SchemaContract.response("/api/v1/ledgers/{ledgerId}/contacts/{contactId}", "get", "200"),
        ),
    )

    @Test
    fun servicesMatch() = assertMatches(
        SchemaContract.differences(
            ServiceList.serializer().descriptor,
            SchemaContract.response("/api/v1/ledgers/{ledgerId}/receivables", "get", "200"),
        ),
    )

    @Test
    fun paymentsMatch() = assertMatches(
        SchemaContract.differences(
            PaymentList.serializer().descriptor,
            SchemaContract.response("/api/v1/ledgers/{ledgerId}/receivables/{receivableId}/payments", "get", "200"),
        ),
    )

    @Test
    fun historyMatches() = assertMatches(
        SchemaContract.differences(
            HistoryList.serializer().descriptor,
            SchemaContract.response("/api/v1/ledgers/{ledgerId}/contacts/{contactId}/history", "get", "200"),
        ),
    )

    @Test
    fun loanPeopleMatch() = assertMatches(
        SchemaContract.differences(
            LoanPersonList.serializer().descriptor,
            SchemaContract.response("/api/v1/ledgers/{ledgerId}/loans", "get", "200"),
        ),
    )

    @Test
    fun loansMatch() = assertMatches(
        SchemaContract.differences(
            LoanList.serializer().descriptor,
            SchemaContract.response("/api/v1/ledgers/{ledgerId}/contacts/{contactId}/loans", "get", "200"),
        ),
    )

    @Test
    fun problemMatches() = assertMatches(
        SchemaContract.differences(Problem.serializer().descriptor, SchemaContract.response("/api/v1/ledgers", "get", "401")),
    )

    @Test
    fun moneyMatches() = assertMatches(
        SchemaContract.differences(Money.serializer().descriptor, SchemaContract.component("UsdMoney")),
    )

    @Test
    fun moneyAmountIsALongBecauseTheContractAllowsLargeIntegers() {
        val schema = SchemaContract.component("UsdMoney")
        assertTrue(SchemaContract.differences(MoneyWithIntAmount.serializer().descriptor, schema).any { it.contains("amount") })
    }

    @Test
    fun theCheckerReportsMissingExtraAndMismatchedFields() {
        val problems = SchemaContract.differences(
            Drifted.serializer().descriptor,
            SchemaContract.response("/api/health", "get", "200"),
        )
        assertTrue(problems.toString(), problems.any { it.contains("status") && it.contains("not in Kotlin") })
        assertTrue(problems.toString(), problems.any { it.contains("extra") && it.contains("not in the contract") })
        assertEquals(2, problems.size)
    }

    @Test
    fun theCheckerReportsADefaultOnARequiredField() {
        val problems = SchemaContract.differences(
            HealthWithDefault.serializer().descriptor,
            SchemaContract.response("/api/health", "get", "200"),
        )
        assertTrue(problems.toString(), problems.single().contains("required"))
    }

    @Test
    fun theCheckerReportsANullableMismatch() {
        val problems = SchemaContract.differences(
            LedgerWithNonNullTimeZone.serializer().descriptor,
            SchemaContract.response("/api/v1/ledgers", "get", "200")
                .getValue("properties").jsonObject.getValue("items").jsonObject.getValue("items").jsonObject,
        )
        assertTrue(problems.toString(), problems.any { it.contains("timeZone") && it.contains("nullable") })
    }

    @Test
    fun theCheckerReadsATypeListWithNullAsNullable() {
        val schema = Json.parseToJsonElement("""{"type":["string","null"]}""").jsonObject
        assertEquals(emptyList<String>(), SchemaContract.differences(String.serializer().nullable.descriptor, schema))
        val problems = SchemaContract.differences(String.serializer().descriptor, schema)
        assertTrue(problems.toString(), problems.single().contains("nullable"))
    }

    @Test
    fun theApiJsonIgnoresFieldsAddedByANewerServer() {
        val health = ApiJson.decodeFromString(Health.serializer(), """{"status":"ok","added":1}""")
        assertEquals("ok", health.status)
    }

    @Serializable
    private data class Drifted(val extra: String)

    @Serializable
    private data class OptionalTarget(val targetId: String? = null)

    @Serializable
    private data class BodyAsText(val body: String)

    @Serializable
    private data class HealthWithDefault(val status: String = "ok")

    @Serializable
    private data class MoneyWithIntAmount(val amount: Int, val currency: String)

    @Serializable
    private data class LedgerWithNonNullTimeZone(
        val id: String,
        val name: String,
        val baseCurrency: String,
        val timeZone: String,
        val version: Int,
        val role: String,
    )
}
