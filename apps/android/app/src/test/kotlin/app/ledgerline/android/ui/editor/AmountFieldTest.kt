package app.ledgerline.android.ui.editor

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The money box on screen: typing from the cents fills in from the right; the ordinary box keeps what is typed. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class AmountFieldTest {
    @get:Rule
    val compose = createComposeRule()

    private var amount by mutableStateOf("")

    private fun show(centsFirst: Boolean, digits: Int = 2, hero: Boolean = false, problem: String? = null) {
        compose.setContent {
            AmountField(amount, { amount = it }, digits, centsFirst, label = "Amount", isError = problem != null, supportingText = problem, hero = hero)
        }
    }

    private val field get() = compose.onNode(hasSetTextAction())

    @Test
    fun typedDigitsFillInFromTheRightWhenOn() {
        show(centsFirst = true)
        field.performTextInput("1")
        assertEquals("0.01", amount)
        field.performTextInput("2")
        field.performTextInput("3")
        assertEquals("1.23", amount)
    }

    @Test
    fun theCaretStaysAtTheEnd() {
        show(centsFirst = true)
        // One character per keystroke, as a keyboard reports them.
        "123".forEach { field.performTextInput(it.toString()) }
        compose.waitForIdle()
        val selection = field.fetchSemanticsNode().config[SemanticsProperties.TextSelectionRange]
        assertEquals("1.23".length, selection.start)
        assertEquals("1.23".length, selection.end)
    }

    @Test
    fun aPastedAmountIsReadTheOrdinaryWay() {
        show(centsFirst = true)
        // Several characters arriving at once are a paste: 12.50 is twelve fifty, not the digits 1250 typed.
        field.performTextInput("12.50")
        assertEquals("12.50", amount)
    }

    @Test
    fun replacingTheWholeBoxStartsOverFromTheDigits() {
        amount = "12.34"
        show(centsFirst = true)
        field.performTextReplacement("5")
        assertEquals("0.05", amount)
    }

    @Test
    fun followsTheCurrencysDecimals() {
        show(centsFirst = true, digits = 0)
        "1500".forEach { field.performTextInput(it.toString()) }
        assertEquals("1500", amount)
    }

    @Test
    fun theOrdinaryBoxKeepsExactlyWhatIsTyped() {
        show(centsFirst = false)
        field.performTextInput("12,5")
        assertEquals("12,5", amount)
    }

    @Test
    fun anAmountChangedFromOutsideShowsInTheBox() {
        show(centsFirst = true)
        amount = "7.50"
        compose.waitForIdle()
        field.performTextInput("1")
        assertEquals("75.01", amount)
    }

    @Test
    fun theHeroAmountTypesFromTheCentsLikeTheBoxedOne() {
        show(centsFirst = true, hero = true)
        "123".forEach { field.performTextInput(it.toString()) }
        assertEquals("1.23", amount)
    }

    @Test
    fun theOrdinaryHeroAmountKeepsExactlyWhatIsTyped() {
        show(centsFirst = false, hero = true)
        field.performTextInput("12,5")
        assertEquals("12,5", amount)
    }

    @Test
    fun anEmptyHeroAmountShowsWhatTypingWillFillIn() {
        show(centsFirst = true, hero = true)
        compose.onNodeWithText("0.00").assertExists()
        field.performTextInput("5")
        compose.onNodeWithText("0.00").assertDoesNotExist()
    }

    @Test
    fun anEmptyHeroAmountWithoutCentsFirstShowsZero() {
        show(centsFirst = false, hero = true)
        compose.onNodeWithText("0").assertExists()
    }

    @Test
    fun theHeroAmountSaysItsProblemInWordsUnderIt() {
        show(centsFirst = false, hero = true, problem = "Enter an amount.")
        compose.onNodeWithText("Enter an amount.").assertExists()
    }
}
