package app.ledgerline.android.ui.budgets

import app.ledgerline.android.ui.editor.AmountInput
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Set limit form's rules (ADR 0046): what opens it, what is a valid limit, and the request it makes. */
class BudgetLimitFormTest {
    private fun form(budget: Long?, text: String = "", carriedIn: Long = 0, archived: Boolean = false, rollover: Boolean = false): LimitForm? {
        var line = budgetLine("Food", budget, 6956, carriedIn = carriedIn).copy(archived = archived)
        if (rollover && line.budget != null) line = line.copy(budget = line.budget!!.copy(rollover = true))
        return LimitForm.forLine(line, "2026-10")?.let { if (text.isEmpty()) it else it.copy(text = text) }
    }

    @Test
    fun anArchivedCategoryHasNoLimitToSet() {
        assertNull(form(null, archived = true))
        assertNull(form(10000, archived = true))
    }

    @Test
    fun aCategoryWithoutALimitOpensEmptyAndAnExistingOneOpensFilledIn() {
        val new = form(null)!!
        assertEquals("", new.text)
        assertFalse(new.editing)
        val existing = form(20000)!!
        assertEquals("200.00", existing.text)
        assertTrue(existing.editing)
    }

    @Test
    fun theFormKnowsItsCategoryMonthCurrencyAndWhatWasSpent() {
        val f = form(null)!!
        assertEquals("Food", f.target.name)
        assertEquals("2026-10", f.target.month)
        assertEquals("USD", f.target.currency)
        assertEquals(6956L, f.target.spent)
    }

    @Test
    fun aValidAmountIsInMinorUnits() {
        assertEquals(12_050L, form(null, "120.50")!!.minor)
        assertEquals(12_000L, form(null, "120")!!.minor)
        assertEquals(12_050L, form(null, "120,50")!!.minor)
    }

    @Test
    fun eachWrongAmountHasItsOwnProblemAndNothingToSend() {
        mapOf(
            "" to AmountInput.Missing, "abc" to AmountInput.Invalid, "12.345" to AmountInput.TooPrecise,
            "0" to AmountInput.Zero, "0.00" to AmountInput.Zero, "99999999999999999" to AmountInput.TooLarge,
        ).forEach { (text, problem) ->
            val f = form(null, text)!!
            assertEquals(text, problem, f.parsed)
            assertNull(text, f.minor)
            assertNull(text, f.request())
            assertFalse(text, f.canSave)
        }
    }

    @Test
    fun zeroIsNeverALimit() {
        assertFalse(form(null, "0")!!.canSave)
        assertFalse(form(10000, "0.00")!!.canSave)
    }

    @Test
    fun savingNeedsAValidAmountThatIsNotWhatItAlreadyIs() {
        assertTrue(form(null, "50")!!.canSave)
        assertFalse(form(10000)!!.canSave)
        assertFalse(form(10000, "100")!!.canSave)
        assertTrue(form(10000, "101")!!.canSave)
    }

    @Test
    fun aNewLimitSendsNoVersionAndRolloverOff() {
        val request = form(null, "75.25")!!.request()!!
        assertEquals("Food", request.categoryId)
        assertEquals("2026-10", request.month)
        assertEquals(7_525L, request.amount.amount)
        assertEquals("USD", request.amount.currency)
        assertFalse(request.rollover)
        assertNull(request.expectedVersion)
    }

    @Test
    fun anEditSendsTheVersionItHoldsAndKeepsTheRolloverTheWebChose() {
        val request = form(10000, "150", rollover = true)!!.request()!!
        assertEquals(1, request.expectedVersion)
        assertTrue(request.rollover)
        val off = form(10000, "150")!!.request()!!
        assertFalse(off.rollover)
    }

    @Test
    fun whatCarriedInDoesNotChangeTheLimitShownOrSent() {
        val f = form(10000, carriedIn = 5000)!!
        assertEquals("100.00", f.text)
        assertEquals(15_000L, form(10000, "150", carriedIn = 5000)!!.request()!!.amount.amount)
    }

    @Test
    fun thePresetsAreFiftyOneHundredOneFiftyAndTwoFiftyInTheCurrency() {
        assertEquals(listOf(5_000L, 10_000L, 15_000L, 25_000L), limitPresets("USD"))
        assertEquals(listOf(50L, 100L, 150L, 250L), limitPresets("JPY"))
    }
}
