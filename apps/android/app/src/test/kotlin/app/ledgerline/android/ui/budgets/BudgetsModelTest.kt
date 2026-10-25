package app.ledgerline.android.ui.budgets

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.YearMonth

/** The rules behind the Budgets screen (ADR 0046): what is listed first, what is folded away, and the small figures. */
class BudgetsModelTest {
    private fun names(lines: List<app.ledgerline.api.BudgetLine>) = lines.map { it.name }

    @Test
    fun overspentCategoriesComeFirstThenTheRestBySpending() {
        val groups = splitLines(
            listOf(
                budgetLine("Small", 10000, 1000),
                budgetLine("Big", 10000, 9000),
                budgetLine("OverA", 1000, 1500),
                budgetLine("OverB", 1000, 5000),
                budgetLine("Unplanned", null, 4000),
            ),
        )
        assertEquals(listOf("OverB", "OverA", "Big", "Unplanned", "Small"), names(groups.active))
    }

    @Test
    fun aCategoryOverOnlyBecauseOfWhatItCarriedInIsOverspent() {
        val groups = splitLines(listOf(budgetLine("Fine", 10000, 9000), budgetLine("Carried", 10000, 5000, carriedIn = -7000)))
        assertEquals(listOf("Carried", "Fine"), names(groups.active))
    }

    @Test
    fun aBudgetedCategoryWithNothingSpentStaysListedAfterTheSpenders() {
        val groups = splitLines(listOf(budgetLine("Idle", 10000, 0), budgetLine("Busy", null, 100)))
        assertEquals(listOf("Busy", "Idle"), names(groups.active))
        assertEquals(emptyList<String>(), names(groups.folded))
    }

    @Test
    fun onlyCategoriesWithNoBudgetAndNothingSpentAreFolded() {
        val groups = splitLines(listOf(budgetLine("Zero", null, 0), budgetLine("Idle", 100, 0), budgetLine("Spent", null, 1), budgetLine("Also zero", null, 0)))
        assertEquals(listOf("Zero", "Also zero"), names(groups.folded))
        assertEquals(listOf("Spent", "Idle"), names(groups.active))
    }

    @Test
    fun equalSpendingKeepsTheServersOrder() {
        val groups = splitLines(listOf(budgetLine("B", null, 100), budgetLine("A", null, 100)))
        assertEquals(listOf("B", "A"), names(groups.active))
    }

    @Test
    fun percentUsedIsRoundedAndCanPassOneHundred() {
        assertEquals(96, percentUsed(19228, 20000))
        assertEquals(68, percentUsed(45942, 68000))
        assertEquals(110, percentUsed(11000, 10000))
        assertEquals(0, percentUsed(0, 10000))
        assertEquals(1, percentUsed(5, 1000))
    }

    @Test
    fun noPercentWithoutAnAllowance() {
        assertNull(percentUsed(500, 0))
        assertNull(percentUsed(500, -100))
    }

    @Test
    fun daysLeftCountsTheDaysAfterTodayOnlyInTheCurrentMonth() {
        val oct = YearMonth.of(2026, 10)
        assertEquals(7, daysLeft(oct, LocalDate.of(2026, 10, 24)))
        assertEquals(30, daysLeft(oct, LocalDate.of(2026, 10, 1)))
        assertNull(daysLeft(oct, LocalDate.of(2026, 10, 31)))
        assertNull(daysLeft(oct, LocalDate.of(2026, 9, 24)))
        assertNull(daysLeft(oct, LocalDate.of(2026, 11, 2)))
        assertEquals(3, daysLeft(YearMonth.of(2028, 2), LocalDate.of(2028, 2, 26)))
    }

    @Test
    fun shareOfSpendHasOneDecimal() {
        assertEquals("41.9", spendShare(19228, 45942))
        assertEquals("100.0", spendShare(500, 500))
        assertEquals("0.0", spendShare(0, 500))
        assertNull(spendShare(100, 0))
    }

    @Test
    fun theTotalSpentIsEverythingSpentWhetherBudgetedOrNot() {
        assertEquals(1500L, totalSpent(listOf(budgetLine("A", 100, 500), budgetLine("B", null, 1000), budgetLine("C", null, 0))))
    }

    @Test
    fun theAllowanceIsTheBudgetPlusWhatCarriedInAndNullWithoutABudget() {
        assertEquals(40000L, allowanceOf(budgetLine("A", 30000, 0, carriedIn = 10000)))
        assertEquals(5000L, allowanceOf(budgetLine("B", 10000, 0, carriedIn = -5000)))
        assertNull(allowanceOf(budgetLine("C", null, 100)))
    }

    @Test
    fun aBarFillsByWhatIsSpentOfTheAllowance() {
        assertEquals(0.5f, shareOf(5000, 10000))
        assertEquals(1f, shareOf(20000, 10000))
        assertEquals(1f, shareOf(1, 0))
        assertEquals(0f, shareOf(0, 0))
    }
}
