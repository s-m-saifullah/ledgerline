package app.ledgerline.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Every API type the app uses must match docs/openapi.json, so a change to the API breaks the build here. */
class ContractTest {
    private fun assertMatches(problems: List<String>) = assertEquals(emptyList<String>(), problems)

    @Test
    fun budgetLimitRequestsMatch() {
        assertMatches(
            SchemaContract.differences(
                SetBudget.serializer().descriptor,
                SchemaContract.request("/api/v1/ledgers/{ledgerId}/budgets", "put"),
                request = true,
            ),
        )
        assertMatches(
            SchemaContract.differences(
                ExpectedVersion.serializer().descriptor,
                SchemaContract.request("/api/v1/ledgers/{ledgerId}/budgets/{budgetId}", "delete"),
                request = true,
            ),
        )
    }

    @Test
    fun settingABudgetReturnsABudgetWhetherItWasCreatedOrEdited() {
        for (status in listOf("200", "201")) {
            assertMatches(SchemaContract.differences(Budget.serializer().descriptor, SchemaContract.response("/api/v1/ledgers/{ledgerId}/budgets", "put", status)))
        }
    }

    @Test
    fun aNewLimitSendsNoVersionAndAnEditSendsOne() {
        fun body(set: SetBudget) = ApiJson.encodeToString(SetBudget.serializer(), set)
        val amount = Money(12_000, "USD")
        assertEquals(
            """{"categoryId":"c1","month":"2026-10","amount":{"amount":12000,"currency":"USD"},"rollover":false}""",
            body(SetBudget("c1", "2026-10", amount, rollover = false)),
        )
        assertEquals(
            """{"categoryId":"c1","month":"2026-10","amount":{"amount":12000,"currency":"USD"},"rollover":true,"expectedVersion":3}""",
            body(SetBudget("c1", "2026-10", amount, rollover = true, expectedVersion = 3)),
        )
    }

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
    fun recordingAPaymentMatchesTheContract() {
        val path = "/api/v1/ledgers/{ledgerId}/receivables/{receivableId}/payments"
        assertMatches(SchemaContract.differences(CreatePayment.serializer().descriptor, SchemaContract.request(path, "post"), request = true))
        assertMatches(SchemaContract.differences(ServicePayment.serializer().descriptor, SchemaContract.response(path, "post", "201")))
    }

    @Test
    fun aPaymentSendsOnlyWhatItHas() {
        fun body(payment: CreatePayment) = ApiJson.encodeToString(CreatePayment.serializer(), payment)
        val settle = Money(12_000, "USD")
        assertEquals(
            """{"amount":{"amount":12000,"currency":"USD"},"accountId":"a1","categoryId":"c1","date":"2026-11-09","expectedReceivableVersion":3}""",
            body(CreatePayment(settle, accountId = "a1", categoryId = "c1", date = "2026-11-09", expectedReceivableVersion = 3)),
        )
        assertEquals(
            """{"amount":{"amount":12000,"currency":"USD"},"accountId":"a1","categoryId":"c1","date":"2026-11-09","time":"14:30","note":"Cash","tip":{"amount":{"amount":500,"currency":"USD"},"categoryId":"c2"},"expectedReceivableVersion":3}""",
            body(
                CreatePayment(
                    settle, accountId = "a1", categoryId = "c1", date = "2026-11-09", time = "14:30", note = "Cash",
                    tip = TipInput(Money(500, "USD"), "c2"), expectedReceivableVersion = 3,
                ),
            ),
        )
    }

    @Test
    fun lendingBorrowingAndRepayingMatchTheContract() {
        // One path with an {action}: its body is a choice of three, and the first is the move of money the phone sends.
        val path = "/api/v1/ledgers/{ledgerId}/contacts/{contactId}/loans/{action}"
        val move = SchemaContract.request(path, "post")["anyOf"]!!.jsonArray[0].jsonObject
        assertMatches(SchemaContract.differences(LoanMove.serializer().descriptor, move, request = true))
        assertMatches(SchemaContract.differences(LoanResult.serializer().descriptor, SchemaContract.response(path, "post", "201")))
    }

    @Test
    fun aLoanMoveSendsAnEmptyTimeAndNoteAsNullLikeTheWebDoes() {
        fun body(move: LoanMove) = ApiJson.encodeToString(LoanMove.serializer(), move)
        assertEquals(
            """{"accountId":"a1","amount":{"amount":5000,"currency":"USD"},"date":"2026-11-11","time":null,"note":null}""",
            body(LoanMove(accountId = "a1", amount = Money(5_000, "USD"), date = "2026-11-11")),
        )
        assertEquals(
            """{"accountId":"a1","amount":{"amount":5000,"currency":"EUR"},"date":"2026-11-11","time":null,"note":"Lunch"}""",
            body(LoanMove(accountId = "a1", amount = Money(5_000, "EUR"), date = "2026-11-11", note = "Lunch")),
        )
    }

    @Test
    fun theReceiptPreviewMatchesTheContract() = assertMatches(
        SchemaContract.differences(
            ReceiptPreview.serializer().descriptor,
            SchemaContract.response("/api/v1/ledgers/{ledgerId}/contacts/{contactId}/receipt-preview", "get", "200"),
        ),
    )

    @Test
    fun theRateLookupMatchesTheContract() = assertMatches(
        SchemaContract.differences(
            RateLookup.serializer().descriptor,
            SchemaContract.response("/api/v1/ledgers/{ledgerId}/exchange-rates/lookup", "get", "200"),
        ),
    )

    @Test
    fun aRateLookupReadsWithAndWithoutARate() {
        val found = ApiJson.decodeFromString(
            RateLookup.serializer(),
            """{"code":"GBP","date":"2026-11-10","baseCurrency":"USD","rate":"1.2658227848","rateDate":"2026-11-07","source":"api"}""",
        )
        assertEquals(RateLookup("GBP", "2026-11-10", "USD", "1.2658227848", "2026-11-07", "api"), found)
        val missing = ApiJson.decodeFromString(
            RateLookup.serializer(),
            """{"code":"GBP","date":"2026-11-10","baseCurrency":"USD","rate":null,"rateDate":null,"source":null}""",
        )
        assertEquals(RateLookup("GBP", "2026-11-10", "USD", null, null, null), missing)
    }

    @Test
    fun aPaymentAcrossTwoOtherCurrenciesSendsTheRateOnlyWhenItHasOne() {
        fun body(payment: CreatePayment) = ApiJson.encodeToString(CreatePayment.serializer(), payment)
        val base = CreatePayment(
            Money(45_000, "EUR"), receivedAmount = Money(39_000, "GBP"), accountId = "a1", categoryId = "c1", date = "2026-11-10",
            expectedReceivableVersion = 2,
        )
        assertFalse(body(base).contains("fxRate"))
        assertTrue(body(base.copy(fxRate = "1.2658227848")).contains(""""fxRate":"1.2658227848""""))
    }

    @Test
    fun recordingAReceiptMatchesTheContract() {
        val path = "/api/v1/ledgers/{ledgerId}/contacts/{contactId}/receipts"
        assertMatches(SchemaContract.differences(CreateReceipt.serializer().descriptor, SchemaContract.request(path, "post"), request = true))
        assertMatches(SchemaContract.differences(Receipt.serializer().descriptor, SchemaContract.response(path, "post", "201")))
    }

    @Test
    fun aReceiptSendsOnlyWhatItHas() {
        fun body(receipt: CreateReceipt) = ApiJson.encodeToString(CreateReceipt.serializer(), receipt)
        val expected = listOf(ExpectedAllocation("s1", expectedVersion = 2, applied = 12_000), ExpectedAllocation("s2", expectedVersion = 5, applied = 3_000))
        assertEquals(
            """{"amount":{"amount":15000,"currency":"USD"},"accountId":"a1","categoryId":"c1","date":"2026-11-10","expectedAllocations":[{"receivableId":"s1","expectedVersion":2,"applied":12000},{"receivableId":"s2","expectedVersion":5,"applied":3000}]}""",
            body(CreateReceipt(Money(15_000, "USD"), accountId = "a1", categoryId = "c1", date = "2026-11-10", expectedAllocations = expected)),
        )
        assertEquals(
            """{"amount":{"amount":15000,"currency":"USD"},"accountId":"a1","categoryId":"c1","date":"2026-11-10","time":"09:05","note":"Cash","tip":{"amount":{"amount":500,"currency":"USD"},"categoryId":"c2"},"expectedAllocations":[{"receivableId":"s1","expectedVersion":2,"applied":12000},{"receivableId":"s2","expectedVersion":5,"applied":3000}]}""",
            body(
                CreateReceipt(
                    Money(15_000, "USD"), accountId = "a1", categoryId = "c1", date = "2026-11-10", time = "09:05", note = "Cash",
                    tip = TipInput(Money(500, "USD"), "c2"), expectedAllocations = expected,
                ),
            ),
        )
    }

    @Test
    fun meMatches() = assertMatches(
        SchemaContract.differences(
            Me.serializer().descriptor,
            SchemaContract.response("/api/v1/me", "get", "200"),
        ),
    )

    @Test
    fun theAccountReplyDecodesWhenAServerAddsFields() {
        val text = """{"id":"01900000-0000-7000-8000-000000000001","name":"Sam","email":"you@example.com","isAdmin":true,""" +
            """"mustChangePassword":true,"twoFactorEnabled":false,"somethingNew":1}"""
        assertEquals(true, ApiJson.decodeFromString(Me.serializer(), text).mustChangePassword)
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
    fun loggingAServiceMatchesTheContract() {
        val path = "/api/v1/ledgers/{ledgerId}/receivables"
        assertMatches(SchemaContract.differences(CreateService.serializer().descriptor, SchemaContract.request(path, "post"), request = true))
        assertMatches(SchemaContract.differences(Service.serializer().descriptor, SchemaContract.response(path, "post", "201")))
    }

    @Test
    fun editingAServiceMatchesTheContract() {
        val path = "/api/v1/ledgers/{ledgerId}/receivables/{receivableId}"
        assertMatches(SchemaContract.differences(UpdateService.serializer().descriptor, SchemaContract.request(path, "patch"), request = true))
        assertMatches(SchemaContract.differences(Service.serializer().descriptor, SchemaContract.response(path, "patch", "200")))
    }

    @Test
    fun deletingAServiceMatchesTheContract() {
        val path = "/api/v1/ledgers/{ledgerId}/receivables/{receivableId}"
        assertMatches(SchemaContract.differences(ExpectedVersion.serializer().descriptor, SchemaContract.request(path, "delete"), request = true))
    }

    @Test
    fun anEditedServiceSendsAClearedTimeAndDueDateAsNullNotAsMissing() {
        fun body(service: UpdateService) = ApiJson.encodeToString(UpdateService.serializer(), service)
        val cost = Money(12_000, "USD")
        assertEquals(
            """{"contactId":"c1","description":"Logo","serviceDate":"2026-11-11","serviceTime":null,"dueDate":null,"amount":{"amount":12000,"currency":"USD"},"expectedVersion":3}""",
            body(UpdateService("c1", "Logo", "2026-11-11", null, null, cost, 3)),
        )
        assertEquals(
            """{"contactId":"c1","description":"Logo","serviceDate":"2026-11-11","serviceTime":"09:30","dueDate":"2026-12-01","amount":{"amount":12000,"currency":"USD"},"expectedVersion":3}""",
            body(UpdateService("c1", "Logo", "2026-11-11", "09:30", "2026-12-01", cost, 3)),
        )
    }

    @Test
    fun aServiceSendsOnlyWhatItHas() {
        fun body(service: CreateService) = ApiJson.encodeToString(CreateService.serializer(), service)
        val cost = Money(12_000, "USD")
        assertEquals(
            """{"contactId":"c1","description":"Logo","serviceDate":"2026-11-11","amount":{"amount":12000,"currency":"USD"}}""",
            body(CreateService("c1", "Logo", "2026-11-11", amount = cost)),
        )
        assertEquals(
            """{"contactId":"c1","description":"Logo","serviceDate":"2026-11-11","serviceTime":"09:30","dueDate":"2026-12-01","amount":{"amount":12000,"currency":"USD"}}""",
            body(CreateService("c1", "Logo", "2026-11-11", serviceTime = "09:30", dueDate = "2026-12-01", amount = cost)),
        )
    }

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
