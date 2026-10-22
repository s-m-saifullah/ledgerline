package app.ledgerline.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Every API type the app uses must match docs/openapi.json, so a change to the API breaks the build here. */
class ContractTest {
    private fun assertMatches(problems: List<String>) = assertEquals(emptyList<String>(), problems)

    @Test
    fun healthMatches() = assertMatches(
        SchemaContract.differences(Health.serializer().descriptor, SchemaContract.response("/api/health", "get", "200")),
    )

    @Test
    fun ledgersMatch() = assertMatches(
        SchemaContract.differences(LedgerList.serializer().descriptor, SchemaContract.response("/api/v1/ledgers", "get", "200")),
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
    fun theApiJsonIgnoresFieldsAddedByANewerServer() {
        val health = ApiJson.decodeFromString(Health.serializer(), """{"status":"ok","added":1}""")
        assertEquals("ok", health.status)
    }

    @Serializable
    private data class Drifted(val extra: String)

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
