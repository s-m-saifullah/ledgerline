package app.ledgerline.android.ui.clients

import app.ledgerline.api.CreateService
import app.ledgerline.api.Money
import org.junit.Assert.assertEquals
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
}
