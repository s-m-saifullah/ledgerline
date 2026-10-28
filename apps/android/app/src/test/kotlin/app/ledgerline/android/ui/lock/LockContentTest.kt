package app.ledgerline.android.ui.lock

import android.app.Application
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import app.ledgerline.android.session.Protection
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The lock screen and the keep-signed-in offer as plain data: one line, one primary button, one link. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class LockContentTest {
    @get:Rule
    val compose = createComposeRule()

    private val log = mutableListOf<String>()
    private val actions = LockActions({ log += "primary" }, { log += "secondary" })

    private fun button(text: String) = compose.onNode(hasText(text) and hasClickAction())

    @Test
    fun theLockedScreenSaysItIsLockedInOneLineAndHasUnlockAndASignInLink() {
        compose.setContent { LockedContent(LockUiState(), actions) }
        compose.onNodeWithText("Ledgerline is locked").assertExists()
        compose.onNodeWithText("Use your fingerprint or screen lock.").assertExists()
        button("Unlock").performClick()
        button("Sign in again instead").performClick()
        assertEquals(listOf("primary", "secondary"), log)
    }

    @Test
    fun whileBusyNeitherButtonWorks() {
        compose.setContent { LockedContent(LockUiState(busy = true), actions) }
        button("Unlock").assertIsNotEnabled()
        button("Sign in again instead").assertIsNotEnabled()
    }

    @Test
    fun aFailedAndALockedOutAttemptAreSaidDifferently() {
        compose.setContent { LockedContent(LockUiState(problem = LockProblem.Failed), actions) }
        compose.onNodeWithText("That did not work", substring = true).assertExists()
    }

    @Test
    fun aLockedOutAttemptSaysToWait() {
        compose.setContent { LockedContent(LockUiState(problem = LockProblem.LockedOut), actions) }
        compose.onNodeWithText("Too many attempts", substring = true).assertExists()
    }

    @Test
    fun theOfferWithAScreenLockAsksAndAllowsNotNow() {
        compose.setContent { KeepSignedInContent(LockUiState(), Protection.Available, actions) }
        compose.onNodeWithText("Stay signed in?").assertExists()
        compose.onNodeWithText("Open Ledgerline with your fingerprint or screen lock instead of your password.").assertExists()
        button("Use fingerprint or screen lock").assertIsEnabled().performClick()
        button("Not now").performClick()
        assertEquals(listOf("primary", "secondary"), log)
    }

    @Test
    fun theOfferWithoutAScreenLockOnlyContinues() {
        compose.setContent { KeepSignedInContent(LockUiState(), Protection.NoScreenLock, actions) }
        compose.onNodeWithText("No screen lock is set up", substring = true).assertExists()
        button("Use fingerprint or screen lock").assertDoesNotExist()
        button("Not now").assertDoesNotExist()
        button("Continue").performClick()
        assertEquals(listOf("secondary"), log)
    }

    @Test
    fun theOfferOnAPhoneThatCannotProtectOnlyContinues() {
        compose.setContent { KeepSignedInContent(LockUiState(), Protection.Unavailable, actions) }
        compose.onNodeWithText("cannot keep a sign-in safely", substring = true).assertExists()
        button("Continue").performClick()
        assertEquals(listOf("secondary"), log)
    }

    @Test
    fun theOffersButtonsAreOffWhileBusy() {
        compose.setContent { KeepSignedInContent(LockUiState(busy = true), Protection.Available, actions) }
        button("Use fingerprint or screen lock").assertIsNotEnabled()
        button("Not now").assertIsNotEnabled()
    }
}
