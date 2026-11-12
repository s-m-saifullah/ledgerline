package app.ledgerline.android.ui.clients

import app.ledgerline.api.CreateService
import app.ledgerline.api.Money
import app.ledgerline.api.UpdateService
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Log service form as plain data (ADR 0050, slice 5): what it starts with, what is wrong with it, what it sends. */
class ServiceFormTest {
    private val client = ServiceClient(id = "client-1", name = "Northwind Design")

    private fun form(
        description: String = "Logo refresh",
        amount: String = "450.00",
        time: String? = null,
        due: String? = null,
        currency: String = "USD",
    ) = ServiceForm(client, description, serviceDate = "2026-11-11", serviceTime = time, dueDate = due, currency = currency, amount = amount)

    private val label: (Long, String) -> String = { rate, code -> "$code $rate" }

    @Test
    fun aNewFormStartsWithTodayAndTheBaseCurrencyAndNothingTyped() {
        val start = ServiceForm.forClient(client, today = "2026-11-11")
        assertEquals("2026-11-11", start.serviceDate)
        assertEquals(BaseCurrency, start.currency)
        assertEquals("", start.description)
        assertEquals("", start.amount)
        assertNull(start.serviceTime)
        assertNull(start.dueDate)
        assertEquals("", start.hours)
        assertEquals("", start.hourlyRate)
    }

    @Test
    fun aCompleteFormHasNoProblemsAndSendsTheBody() {
        assertEquals(emptyList<ServiceProblem>(), form().problems())
        assertEquals(
            CreateService("client-1", "Logo refresh", "2026-11-11", amount = Money(45_000, "USD")),
            form().request(),
        )
    }

    @Test
    fun aTimeAndADueDateAreSentOnlyWhenGiven() {
        val body = form(time = "09:30", due = "2026-12-01").request()!!
        assertEquals("09:30", body.serviceTime)
        assertEquals("2026-12-01", body.dueDate)
        val bare = form().request()!!
        assertNull(bare.serviceTime)
        assertNull(bare.dueDate)
    }

    @Test
    fun theDescriptionIsTrimmedAndAMissingOneIsSaid() {
        assertEquals("Logo", form(description = "  Logo \n").request()!!.description)
        assertEquals(listOf(ServiceProblem.DescriptionMissing), form(description = "").problems())
        assertEquals(listOf(ServiceProblem.DescriptionMissing), form(description = "   ").problems())
        assertNull(form(description = "   ").request())
    }

    @Test
    fun theDescriptionIsAtMost2000Characters() {
        assertEquals(2_000, form(description = "x".repeat(2_500)).request()!!.description.length)
        assertEquals(2_000, ServiceDescriptionMax)
    }

    @Test
    fun eachWayAnAmountCanBeWrongIsSaid() {
        assertEquals(listOf(ServiceProblem.AmountMissing), form(amount = "").problems())
        assertEquals(listOf(ServiceProblem.AmountInvalid), form(amount = "abc").problems())
        assertEquals(listOf(ServiceProblem.AmountTooPrecise), form(amount = "1.234").problems())
        assertEquals(listOf(ServiceProblem.AmountZero), form(amount = "0").problems())
        assertEquals(listOf(ServiceProblem.AmountTooLarge), form(amount = "90071992547409.92").problems())
        assertNull(form(amount = "abc").request())
    }

    @Test
    fun theAmountFollowsTheCurrencysDecimals() {
        assertEquals(Money(1_500, "JPY"), form(amount = "1500", currency = "JPY").request()!!.amount)
        assertEquals(listOf(ServiceProblem.AmountTooPrecise), form(amount = "1500.5", currency = "JPY").problems())
        assertEquals(Money(12_345, "BHD"), form(amount = "12.345", currency = "BHD").request()!!.amount)
        assertEquals(Money(8_000, "EUR"), form(amount = "80", currency = "EUR").request()!!.amount)
    }

    @Test
    fun anAmountMayStartWithThePointOrUseAComma() {
        assertEquals(Money(80, "USD"), form(amount = ".8").request()!!.amount)
        assertEquals(Money(1_250, "USD"), form(amount = "12,5").request()!!.amount)
    }

    @Test
    fun bothProblemsAreSaidTogether() {
        assertEquals(listOf(ServiceProblem.DescriptionMissing, ServiceProblem.AmountMissing), form(description = "", amount = "").problems())
    }

    @Test
    fun theHourlyHelperNeverChangesWhatIsSent() {
        val typed = form().copy(hours = "3.5", hourlyRate = "40")
        assertEquals(form().request(), typed.request())
        assertEquals(form().problems(), typed.copy(hours = "abc").problems())
    }

    @Test
    fun usingTheTotalFillsTheAmountInTheCurrencysDecimals() {
        val used = form(amount = "", description = "Logo").copy(hours = "3.5", hourlyRate = "40").useTotal(label)
        assertEquals("140.00", used.amount)
        assertEquals("Logo", used.description)
        val yen = form(amount = "", currency = "JPY").copy(hours = "2", hourlyRate = "700").useTotal(label)
        assertEquals("1400", yen.amount)
        val dinar = form(amount = "", currency = "BHD").copy(hours = "2", hourlyRate = "7").useTotal(label)
        assertEquals("14.000", dinar.amount)
    }

    @Test
    fun usingTheTotalReplacesWhatWasTypedInTheAmount() {
        assertEquals("140.00", form(amount = "999").copy(hours = "3.5", hourlyRate = "40").useTotal(label).amount)
    }

    @Test
    fun aBlankDescriptionIsFilledWithHowTheTotalWasWorkedOut() {
        val used = form(description = "  ", amount = "").copy(hours = "3.5", hourlyRate = "40").useTotal(label)
        assertEquals("3.5 h at USD 4000/h", used.description)
    }

    @Test
    fun theWordsAreLeftOutWhenAmountsAreHiddenBecauseTheyHoldTheRate() {
        val hidden = form(description = "  ", amount = "").copy(hours = "3.5", hourlyRate = "40").useTotal(label, describe = false)
        assertEquals("140.00", hidden.amount)
        assertEquals("  ", hidden.description)
    }

    @Test
    fun aDescriptionAlreadyTypedIsKept() {
        assertEquals("Logo refresh", form().copy(hours = "3.5", hourlyRate = "40").useTotal(label).description)
    }

    @Test
    fun theHoursAndRateStayTypedAfterUsingTheTotal() {
        val used = form(amount = "").copy(hours = "3.5", hourlyRate = "40").useTotal(label)
        assertEquals("3.5", used.hours)
        assertEquals("40", used.hourlyRate)
    }

    @Test
    fun usingTheTotalWithNothingWorkedOutChangesNothing() {
        val start = form(amount = "12").copy(hours = "abc", hourlyRate = "40")
        assertEquals(start, start.useTotal(label))
        val empty = form(amount = "12")
        assertEquals(empty, empty.useTotal(label))
    }

    @Test
    fun theHourlyResultFollowsTheFormsCurrency() {
        val yen = form(currency = "JPY").copy(hours = "2", hourlyRate = "700")
        assertEquals(1_400L, (yen.hourly as HourlyResult.Total).total)
        assertTrue(form().hourly == null)
    }

    // ---- editing an existing service (ADR 0050, slice 5b)

    private val saved = service("Logo refresh", 45_000, received = 10_000, date = "2026-10-02", time = "14:30", due = "2026-10-20", id = "logo-refresh")

    private fun editing(service: app.ledgerline.api.Service = saved) = ServiceForm.forEditing(client, service)

    @Test
    fun anEditFormStartsWithWhatTheServiceHas() {
        val form = editing()
        assertEquals("Logo refresh", form.description)
        assertEquals("2026-10-02", form.serviceDate)
        assertEquals("14:30", form.serviceTime)
        assertEquals("2026-10-20", form.dueDate)
        assertEquals("USD", form.currency)
        assertEquals("450.00", form.amount)
        assertEquals("", form.hours)
        assertEquals("", form.hourlyRate)
        assertEquals(ServiceEdit("logo-refresh", 1, received = 10_000), form.editing)
    }

    @Test
    fun anEditFormKeepsTheServicesOwnCurrencyAndItsDecimals() {
        assertEquals("EUR", editing(service("Print", 12_000, currency = "EUR")).currency)
        assertEquals("1500", editing(service("Print", 1_500, currency = "JPY")).amount)
        assertEquals("12.345", editing(service("Print", 12_345, currency = "BHD")).amount)
    }

    @Test
    fun aServiceWithoutATimeOrADueDateStartsWithNone() {
        val form = editing(service("Logo", 1_000))
        assertNull(form.serviceTime)
        assertNull(form.dueDate)
    }

    @Test
    fun theCurrencyIsLockedOnceMoneyWasReceivedAndOnlyThen() {
        assertTrue(editing(saved).currencyLocked)
        assertFalse(editing(service("Logo", 45_000, received = 0)).currencyLocked)
        assertFalse(form().currencyLocked)
    }

    @Test
    fun anUntouchedEditFormHasNoProblemsAndSendsEverythingWithTheVersion() {
        assertEquals(emptyList<ServiceProblem>(), editing().problems())
        assertEquals(
            UpdateService("client-1", "Logo refresh", "2026-10-02", "14:30", "2026-10-20", Money(45_000, "USD"), 1),
            editing().updateRequest(),
        )
    }

    @Test
    fun aClearedTimeAndDueDateAreSentAsNullsSoTheServerClearsThem() {
        val body = editing().copy(serviceTime = null, dueDate = null).updateRequest()!!
        assertNull(body.serviceTime)
        assertNull(body.dueDate)
    }

    @Test
    fun anEditedDescriptionAndAmountAreSentTrimmedAndExact() {
        val body = editing().copy(description = "  New name ", amount = "500.5").updateRequest()!!
        assertEquals("New name", body.description)
        assertEquals(Money(50_050, "USD"), body.amount)
    }

    @Test
    fun theEditRequestUsesTheVersionThePhoneHolds() {
        val body = ServiceForm.forEditing(client, saved.copy(version = 7)).updateRequest()!!
        assertEquals(7, body.expectedVersion)
    }

    @Test
    fun anEditWithAProblemSendsNothing() {
        assertNull(editing().copy(description = " ").updateRequest())
        assertNull(editing().copy(amount = "").updateRequest())
    }

    @Test
    fun anAmountBelowWhatWasReceivedIsAProblemButTheSameOrMoreIsNot() {
        assertEquals(listOf(ServiceProblem.AmountBelowReceived), editing().copy(amount = "99.99").problems())
        assertEquals(emptyList<ServiceProblem>(), editing().copy(amount = "100.00").problems())
        assertEquals(emptyList<ServiceProblem>(), editing().copy(amount = "100.01").problems())
        assertNull(editing().copy(amount = "99.99").updateRequest())
    }

    @Test
    fun theReceivedFloorOnlyAppliesToAnEdit() {
        assertEquals(emptyList<ServiceProblem>(), form(amount = "0.01").problems())
    }

    @Test
    fun aBadAmountIsSaidAsAnAmountProblemNotAsBelowReceived() {
        assertEquals(listOf(ServiceProblem.AmountInvalid), editing().copy(amount = "abc").problems())
        assertEquals(listOf(ServiceProblem.AmountZero), editing(service("Logo", 45_000)).copy(amount = "0").problems())
    }

    @Test
    fun theHourlyHelperStillFillsTheAmountOfAnEdit() {
        val used = editing().copy(hours = "3.5", hourlyRate = "40").useTotal(label)
        assertEquals("140.00", used.amount)
        assertEquals("Logo refresh", used.description)
        assertEquals(used.editing, editing().editing)
    }
}

