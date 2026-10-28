package app.ledgerline.android.ui.signin

import android.app.Application
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.unit.dp
import app.ledgerline.android.session.SessionEnd
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Sign-in as plain data: the password step, the code step, the notices and what each control reports. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class SignInContentTest {
    @get:Rule
    val compose = createComposeRule()

    private val log = mutableListOf<String>()
    private var current by mutableStateOf(SignInUiState())

    /** The typed fields come back as state, as the view model does, so one box never resets another. */
    private val actions = SignInActions(
        onEmail = { log += "email:$it"; current = current.copy(email = it) },
        onPassword = { log += "password:$it"; current = current.copy(password = it) },
        onCode = { log += "code:$it"; current = current.copy(code = it) },
        onUseBackupCode = { log += "backup:$it" },
        submit = { log += "submit" },
        backToPassword = { log += "back" },
        dismissNotice = { log += "dismiss" },
        changeAddress = { log += "address" },
    )

    private fun show(state: SignInUiState = SignInUiState(), ended: SessionEnd? = null, origin: String = "https://ledgerline.example.com") {
        current = state
        compose.setContent { SignInContent(current, ended, origin, actions, Modifier.requiredHeight(1500.dp)) }
    }

    /** What a box actually shows (the password hidden or not), read from its text layout. */
    private fun shown(description: String): String {
        val results = mutableListOf<TextLayoutResult>()
        compose.onNodeWithContentDescription(description).fetchSemanticsNode().config[SemanticsActions.GetTextLayoutResult].action?.invoke(results)
        return results.first().layoutInput.text.text
    }

    private fun button(text: String) = compose.onNode(hasText(text) and hasClickAction())

    @Test
    fun thePasswordStepHasEmailPasswordAndOneSignInButtonAndNoBackArrow() {
        show()
        compose.onNodeWithText("Email").assertExists()
        compose.onNodeWithText("Password").assertExists()
        button("Sign in").assertIsEnabled()
        compose.onNodeWithContentDescription("Back").assertDoesNotExist()
    }

    @Test
    fun typingAndSigningInReport() {
        show()
        compose.onNode(hasSetTextAction() and androidx.compose.ui.test.hasContentDescription("Email")).performTextReplacement("you@example.com")
        compose.onNode(hasSetTextAction() and androidx.compose.ui.test.hasContentDescription("Password")).performTextReplacement("secret")
        button("Sign in").performClick()
        assertEquals(listOf("email:you@example.com", "password:secret", "submit"), log)
    }

    @Test
    fun thePasswordIsHiddenUntilShowIsTapped() {
        show(SignInUiState(password = "secret"))
        assertEquals("••••••", shown("Password"))
        button("Show").performClick()
        assertEquals("secret", shown("Password"))
        button("Hide").performClick()
        assertEquals("••••••", shown("Password"))
    }

    @Test
    fun whileSigningInNothingCanBeSentAgainAndTheScreenSaysSo() {
        show(SignInUiState(submitting = true))
        button("Sign in").assertIsNotEnabled()
        compose.onNodeWithText("Signing in…").assertExists()
    }

    @Test
    fun aProblemIsSaidInWords() {
        show(SignInUiState(problem = SignInProblem.BadCredentials))
        compose.onNodeWithText("The email or password is not right.").assertExists()
    }

    @Test
    fun theServerIsOneRowWithoutTheSchemeAndATapOpensTheAddressScreen() {
        show()
        compose.onNodeWithText("Server").assertExists()
        compose.onNodeWithText("ledgerline.example.com").assertExists()
        compose.onNodeWithText("https://ledgerline.example.com").assertDoesNotExist()
        compose.onNodeWithText("Server").performClick()
        assertEquals(listOf("address"), log)
    }

    private fun endedNotice(reason: SessionEnd, text: String) {
        show(ended = reason)
        compose.onNodeWithText(text, substring = true).assertExists()
        compose.onNodeWithText("Dismiss").performClick()
        assertEquals(listOf("dismiss"), log)
    }

    @Test
    fun anExpiredSessionIsSaidAndDismissReports() = endedNotice(SessionEnd.Expired, "Your session ended")

    @Test
    fun aServerThatCouldNotBeReachedIsSaidWithWhatToDoNext() = endedNotice(SessionEnd.ServerNotReached, "Remove this phone under Settings")

    @Test
    fun aChangedScreenLockIsSaidWithWhereTheOldSignInStays() = endedNotice(SessionEnd.KeyLost, "screen lock or fingerprints changed")

    @Test
    fun noNoticeShowsWhenNothingEnded() {
        show()
        compose.onNodeWithText("Dismiss").assertDoesNotExist()
    }

    @Test
    fun theCodeStepHasABackArrowTheCodeBoxAndNoServerRowOrSignInButton() {
        show(SignInUiState(step = SignInStep.Code))
        compose.onNodeWithText("Enter your code").assertExists()
        compose.onNodeWithText("Six-digit code").assertExists()
        compose.onNodeWithText("Server").assertDoesNotExist()
        button("Sign in").assertDoesNotExist()
        compose.onNodeWithContentDescription("Back").performClick()
        assertEquals(listOf("back"), log)
    }

    @Test
    fun theBackArrowDoesNothingWhileTheCodeIsBeingChecked() {
        show(SignInUiState(step = SignInStep.Code, submitting = true))
        compose.onNodeWithContentDescription("Back").performClick()
        assertEquals(emptyList<String>(), log)
    }

    @Test
    fun theCodeIsTypedAndVerifiedWithOneButton() {
        show(SignInUiState(step = SignInStep.Code))
        compose.onNode(hasSetTextAction()).performTextReplacement("123456")
        button("Verify").performClick()
        assertEquals(listOf("code:123456", "submit"), log)
    }

    @Test
    fun theBackupCodeIsAnOffer_notASwitch_andTheWordsFollowIt() {
        show(SignInUiState(step = SignInStep.Code))
        compose.onNodeWithText("The six-digit code from your authenticator app.").assertExists()
        button("Use a backup code").performClick()
        assertEquals(listOf("backup:true"), log)
    }

    @Test
    fun withTheBackupCodeOnTheBoxAndTheOfferChange() {
        show(SignInUiState(step = SignInStep.Code, useBackupCode = true))
        compose.onNodeWithText("Backup code").assertExists()
        compose.onNodeWithText("One of your backup codes. Each works once.").assertExists()
        button("Use the six-digit code").performClick()
        assertEquals(listOf("backup:false"), log)
    }

    @Test
    fun theCodeStepsLinkIsOffWhileChecking() {
        show(SignInUiState(step = SignInStep.Code, submitting = true))
        button("Use a backup code").assertIsNotEnabled()
        button("Verify").assertIsNotEnabled()
    }

    @Test
    fun theSignInLabelsSitBesideTheirBoxesNotAboveThem() {
        show()
        val label = compose.onNodeWithText("Email").getUnclippedBoundsInRoot()
        val box = compose.onNode(hasSetTextAction() and androidx.compose.ui.test.hasContentDescription("Email")).getUnclippedBoundsInRoot()
        assert(label.right <= box.left + 1.dp) { "the label (${label.right}) is not left of the box (${box.left})" }
    }
}
