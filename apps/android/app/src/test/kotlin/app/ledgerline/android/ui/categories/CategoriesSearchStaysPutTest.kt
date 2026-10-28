package app.ledgerline.android.ui.categories

import android.app.Application
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.unit.dp
import app.ledgerline.android.mirror.CategoryRow
import app.ledgerline.android.mirror.syncCategory
import app.ledgerline.android.mirror.toRow
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Typing in the search shortens the list below it. With the keyboard open the screen is short and the list is scrolled;
 * a shorter list used to pull the scroll position back and slide the search field down under the owner's fingers
 * (Clients and Loans had the same bug). The search now sits in a fixed header above the list, so it must stay where it is.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class CategoriesSearchStaysPutTest {
    @get:Rule
    val compose = createComposeRule()

    // Eight main categories with two subcategories each, so the list is taller than the short screen.
    private val items: List<CategoryRow> = (1..8).flatMap { n ->
        listOf(syncCategory(n * 10, "Main $n", sortOrder = n.toLong())) +
            (1..2).map { syncCategory(n * 10 + it, "Sub $n.$it", parentN = n * 10, sortOrder = it.toLong()) }
    }.map { it.toRow("ledger-a") }

    private var search by mutableStateOf("")

    private fun searchTop() = compose.onNode(hasSetTextAction()).getUnclippedBoundsInRoot().top

    private fun show(height: Int) = compose.setContent {
        CategoriesContent(
            CategoriesView(search = search, expanded = items.filter { it.parentId == null }.map { it.id }.toSet()),
            categoryGroups(items, "expense", CategoryStatus.All, search),
            items,
            Taps().actions().let { base ->
                CategoriesActions(
                    {}, {}, {}, { search = it }, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {},
                    base.openMenu, base.closeMenu, base.addUnder, base.toggleGroup, base.toggleAll,
                )
            },
            0.dp,
            Modifier.height(height.dp),
        )
    }

    @Test
    fun theSearchFieldStaysWhereItIsWhenTheListGetsShorter() {
        show(640)
        compose.onNode(hasScrollAction()).performTouchInput { swipeUp() }
        compose.waitForIdle()
        val before = searchTop()

        search = "Sub 1.1"
        compose.waitForIdle()
        assertEquals(before, searchTop())
    }

    @Test
    fun theSearchFieldStaysWhereItIsWhenNothingMatches() {
        show(640)
        compose.onNode(hasScrollAction()).performTouchInput { swipeUp() }
        compose.waitForIdle()
        val before = searchTop()

        search = "zzz"
        compose.waitForIdle()
        assertEquals(before, searchTop())
    }

    @Test
    fun clearingTheSearchAlsoLeavesTheFieldWhereItIs() {
        show(640)
        search = "Main"
        compose.waitForIdle()
        compose.onNode(hasScrollAction()).performTouchInput { swipeUp() }
        compose.waitForIdle()
        val before = searchTop()

        search = ""
        compose.waitForIdle()
        assertEquals(before, searchTop())
    }
}
