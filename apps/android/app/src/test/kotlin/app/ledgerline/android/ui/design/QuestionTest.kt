package app.ledgerline.android.ui.design

import android.app.Application
import androidx.compose.material3.Text
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import app.ledgerline.android.ui.theme.Inter
import app.ledgerline.android.ui.theme.LedgerlineTheme
import app.ledgerline.android.ui.theme.LightPalette
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The shared question (WP-16): its words, its buttons and what each reports, and its look. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class)
class QuestionTest {
    @get:Rule
    val compose = createComposeRule()

    private val log = mutableListOf<String>()

    private fun inDialog(text: String) = hasText(text) and hasAnyAncestor(isDialog())

    private fun show(
        danger: Boolean = false,
        enabled: Boolean = true,
        cancel: String? = "Cancel",
        extra: QuestionAction? = null,
    ) = compose.setContent {
        LedgerlineTheme(darkTheme = false) {
            Question(
                title = "Delete this?",
                confirm = "Delete",
                onConfirm = { log += "confirm" },
                onDismiss = { log += "dismiss" },
                danger = danger,
                enabled = enabled,
                cancel = cancel,
                extra = extra,
            ) { Text("It cannot be undone.") }
        }
    }

    @Test
    fun itShowsTheTitleAsAHeadingAndTheWords() {
        show()
        compose.onNode(inDialog("Delete this?") and SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading)).assertExists()
        compose.onNode(inDialog("It cannot be undone.")).assertExists()
    }

    @Test
    fun theTitleIsTheNineteenSpSectionTitleAndTheWordsAreFourteenInInter() {
        show()
        fun style(text: String) = compose.onNode(inDialog(text)).fetchSemanticsNode().let { node ->
            val results = mutableListOf<TextLayoutResult>()
            node.config[SemanticsActions.GetTextLayoutResult].action!!.invoke(results)
            results.single().layoutInput.style
        }
        assertEquals(19f, style("Delete this?").fontSize.value)
        assertEquals(14f, style("It cannot be undone.").fontSize.value)
        assertEquals(Inter, style("Delete this?").fontFamily)
    }

    @Test
    fun confirmAndCancelEachReportOnlyThemselves() {
        show()
        compose.onNode(inDialog("Delete")).performClick()
        assertEquals(listOf("confirm"), log)
        compose.onNode(inDialog("Cancel")).performClick()
        assertEquals(listOf("confirm", "dismiss"), log)
    }

    @Test
    fun bothButtonsAreAtLeastFortyEightDpTall() {
        show()
        compose.onNode(inDialog("Delete")).assertHeightIsAtLeast(48.dp)
        compose.onNode(inDialog("Cancel")).assertHeightIsAtLeast(48.dp)
    }

    @Test
    fun withoutACancelThereIsOneButton() {
        show(cancel = null)
        compose.onNode(inDialog("Delete")).assertExists()
        assertTrue(compose.onAllNodes(hasText("Cancel")).fetchSemanticsNodes().isEmpty())
    }

    @Test
    fun aThirdActionIsItsOwnButtonAndReportsOnlyItself() {
        show(extra = QuestionAction("Delete 3 unsent changes", { log += "extra" }, danger = true))
        compose.onNode(inDialog("Delete")).assertHeightIsAtLeast(48.dp)
        compose.onNode(inDialog("Cancel")).assertHeightIsAtLeast(48.dp)
        compose.onNode(inDialog("Delete 3 unsent changes")).assertHeightIsAtLeast(48.dp).performClick()
        assertEquals(listOf("extra"), log)
    }

    @Test
    fun everyButtonIsOffWhileARequestIsOnItsWay() {
        show(enabled = false, extra = QuestionAction("Other", {}))
        listOf("Delete", "Cancel", "Other").forEach { compose.onNode(inDialog(it)).assertIsNotEnabled() }
    }

    @Test
    fun theButtonsAreOnOtherwise() {
        show()
        compose.onNode(inDialog("Delete")).assertIsEnabled()
        compose.onNode(inDialog("Cancel")).assertIsEnabled()
    }

    private fun confirmColor(danger: Boolean): Color {
        show(danger = danger)
        val image = compose.onNode(inDialog("Delete")).captureToImage().toPixelMap()
        // A point on the button's fill, left of its text.
        return image[image.width / 12, image.height / 2]
    }

    private fun assertSame(expected: Color, actual: Color) {
        assertEquals(expected.red, actual.red, 0.02f)
        assertEquals(expected.green, actual.green, 0.02f)
        assertEquals(expected.blue, actual.blue, 0.02f)
    }

    @Test
    fun aDeleteIsAFilledRedButton() = assertSame(LightPalette.danger, confirmColor(danger = true))

    @Test
    fun anythingElseIsTheFilledAccentButton() = assertSame(LightPalette.accent, confirmColor(danger = false))

    @Test
    fun theButtonsStackWhenThereAreThreeOrTheTextIsMuchLarger() {
        assertTrue(questionStacked(1f, 3))
        assertTrue(questionStacked(1.31f, 2))
        assertFalse(questionStacked(1f, 2))
        assertFalse(questionStacked(1.3f, 2))
        assertFalse(questionStacked(1f, 1))
    }
}
