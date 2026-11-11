package app.ledgerline.android.ui.clients

import android.app.Application
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import app.ledgerline.android.online.WriteError
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The Delete service question (ADR 0050, slice 5b): what it says, what each button reports, and how a refusal reads. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class DeleteServiceQuestionTest {
    @get:Rule
    val compose = createComposeRule()

    private val log = mutableListOf<String>()

    private fun show(ui: DeleteUi) = compose.setContent {
        DeleteServiceQuestion(ui, DeleteServiceActions(confirm = { log += "confirm" }, dismiss = { log += "dismiss" }))
    }

    private val ask = DeleteUi("logo-refresh", "Logo refresh", 1)

    private fun inDialog(text: String) = hasText(text) and hasAnyAncestor(isDialog())

    @Test
    fun theQuestionNamesTheServiceAndSaysWhenItCanBeDeleted() {
        show(ask)
        compose.onNode(inDialog("Delete service?")).assertExists()
        compose.onNode(inDialog("Logo refresh")).assertExists()
        compose.onNode(inDialog("Delete a service only after its payments are deleted.")).assertExists()
    }

    @Test
    fun deleteAndCancelEachReportOnlyThemselves() {
        show(ask)
        compose.onNode(inDialog("Delete")).performClick()
        assertEquals(listOf("confirm"), log)
        compose.onNode(inDialog("Cancel")).performClick()
        assertEquals(listOf("confirm", "dismiss"), log)
    }

    @Test
    fun bothButtonsAreOffWhileTheDeleteIsBeingSent() {
        show(ask.copy(saving = true))
        compose.onNode(inDialog("Delete")).assertIsNotEnabled()
        compose.onNode(inDialog("Cancel")).assertIsNotEnabled()
    }

    @Test
    fun theButtonsAreOnOtherwise() {
        show(ask)
        compose.onNode(inDialog("Delete")).assertIsEnabled()
        compose.onNode(inDialog("Cancel")).assertIsEnabled()
    }

    private fun refused(error: WriteError, words: String) {
        show(ask.copy(error = error))
        compose.onNode(inDialog(words)).assertExists()
    }

    @Test
    fun theServersSentenceIsShownWhenItRefuses() = refused(WriteError.Rejected("Delete the connected payments first."), "Delete the connected payments first.")

    @Test
    fun offlineIsSaid() = refused(WriteError.Offline, "Needs a connection.")

    @Test
    fun aViewerIsToldTheyCannotDelete() = refused(WriteError.Forbidden, "Your account can't delete services in this ledger.")

    @Test
    fun aFailureIsSaidWithATryAgain() = refused(WriteError.Failed, "Couldn't delete the service. Try again.")

    @Test
    fun noErrorLineShowsWithoutAnError() {
        show(ask)
        compose.onNode(inDialog("Needs a connection.")).assertDoesNotExist()
    }
}
