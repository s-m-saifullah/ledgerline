package app.ledgerline.android.ui.address

import android.app.Application
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextReplacement
import app.ledgerline.android.server.AddressProblem
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The address screen as plain data: one row, one hint, one Continue button, and a back arrow only when an address is saved. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class AddressContentTest {
    @get:Rule
    val compose = createComposeRule()

    private val log = mutableListOf<String>()
    private val actions = AddressActions({ log += "input:$it" }, { log += "continue" }, { log += "cancel" })

    private fun show(state: AddressUiState = AddressUiState(), canCancel: Boolean = false) =
        compose.setContent { AddressContent(state, canCancel, actions) }

    @Test
    fun anEmptyAddressShowsTheExampleAsAHintAndATypedOneReplacesIt() {
        show()
        compose.onNodeWithText("Address").assertExists()
        compose.onNodeWithText("ledgerline.example.com").assertExists()
        compose.onNodeWithText("Nothing leaves your phone until you sign in.").assertExists()
    }

    @Test
    fun aTypedAddressHidesTheHint() {
        show(AddressUiState(input = "https://my.example.com"))
        compose.onNodeWithText("ledgerline.example.com").assertDoesNotExist()
    }

    @Test
    fun typingAndContinuingReport() {
        show()
        compose.onNode(hasSetTextAction()).performTextReplacement("https://my.example.com")
        compose.onNode(hasText("Continue") and hasClickAction()).performClick()
        assertEquals(listOf("input:https://my.example.com", "continue"), log)
    }

    @Test
    fun theKeyboardsDoneKeyContinuesToo() {
        show()
        compose.onNode(hasSetTextAction()).performImeAction()
        assertEquals(listOf("continue"), log)
    }

    private fun problemSaid(problem: AddressProblem, text: String) {
        show(AddressUiState(problem = problem))
        compose.onNodeWithText(text, substring = true).assertExists()
    }

    @Test
    fun anEmptyAddressProblemIsSaid() = problemSaid(AddressProblem.Empty, "Enter the address of your server.")

    @Test
    fun anInvalidAddressProblemIsSaid() = problemSaid(AddressProblem.Invalid, "does not look like a server address")

    @Test
    fun aPlainHttpAddressProblemIsSaid() = problemSaid(AddressProblem.Cleartext, "must start with https://")

    @Test
    fun anAddressWithExtrasProblemIsSaid() = problemSaid(AddressProblem.Extras, "without a path")

    @Test
    fun withoutASavedAddressThereIsNoBackArrow() {
        show(canCancel = false)
        compose.onNodeWithContentDescription("Back").assertDoesNotExist()
    }

    @Test
    fun withASavedAddressTheBackArrowCancels() {
        show(canCancel = true)
        compose.onNodeWithContentDescription("Back").performClick()
        assertEquals(listOf("cancel"), log)
    }

    @Test
    fun theLabelSitsAboveTheBoxSoALongAddressHasTheWholeWidth() {
        show()
        val label = compose.onNodeWithText("Address").getUnclippedBoundsInRoot()
        val box = compose.onNode(hasSetTextAction()).getUnclippedBoundsInRoot()
        assert(label.bottom <= box.top + 1.dp) { "the label (${label.bottom}) is not above the box (${box.top})" }
        // The box is as wide as the card's row, not squeezed beside the label.
        val boxWidth = box.right.value - box.left.value
        val labelWidth = label.right.value - label.left.value
        assert(boxWidth > labelWidth * 2) { "the box is only $boxWidth wide" }
    }
}
