package app.ledgerline.android.ui.update

import android.app.Application
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import app.ledgerline.android.online.Online
import app.ledgerline.android.ui.home.HomeContent
import app.ledgerline.android.ui.home.Mirrored
import app.ledgerline.android.ui.home.homeSummary
import app.ledgerline.android.ui.more.MoreActions
import app.ledgerline.android.ui.more.MoreContent
import app.ledgerline.android.update.Refusal
import app.ledgerline.android.update.Release
import app.ledgerline.android.update.UpdateProblem
import app.ledgerline.android.update.UpdateState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

internal val SampleRelease = Release(
    tag = "android-v0.1.3",
    name = "0.1.3",
    code = 103,
    notes = "Check for updates from Settings.\n- Filters stay as long as you choose.",
    apkName = "ledgerline-android-0.1.3.apk",
    apkSize = 12_582_912,
    hashName = "ledgerline-android-0.1.3.apk.sha256",
)

/** The update screen and the notices, as plain data: what each state says and what each button does. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class UpdateContentTest {
    @get:Rule
    val compose = createComposeRule()

    private class Taps {
        val log = mutableListOf<String>()

        fun actions() = UpdateActions(
            onBack = { log += "back" },
            check = { log += "check" },
            download = { log += "download" },
            cancel = { log += "cancel" },
            install = { log += "install" },
        )
    }

    private fun show(state: UpdateState, taps: Taps = Taps()): Taps {
        compose.setContent { UpdateContent("0.1.2", state, taps.actions(), 0.dp, Modifier.requiredHeight(3000.dp)) }
        return taps
    }

    @Test
    fun beforeAnyCheckOnlyTheButtonIsOffered() {
        val taps = show(UpdateState.Idle)
        compose.onNodeWithText("Version 0.1.2 is installed.").assertExists()
        compose.onNodeWithText("Check for updates").performClick()
        assertEquals(listOf("check"), taps.log)
    }

    @Test
    fun checkingShowsAMessageAndNoButton() {
        show(UpdateState.Checking)
        compose.onNodeWithText("Checking for a newer version…").assertExists()
        compose.onNodeWithText("Check for updates").assertDoesNotExist()
    }

    @Test
    fun upToDateCanBeCheckedAgain() {
        val taps = show(UpdateState.UpToDate)
        compose.onNodeWithText("You have the latest version.").assertExists()
        compose.onNodeWithText("Check again").performClick()
        assertEquals(listOf("check"), taps.log)
    }

    @Test
    fun anAvailableVersionShowsItsSizeItsNotesAndDownloadsOnlyOnTheButton() {
        val taps = show(UpdateState.Available(SampleRelease))
        compose.onNodeWithText("Version 0.1.3 is available (12.0 MB)").assertExists()
        compose.onNodeWithText("What's new").assertExists()
        compose.onNodeWithText("Check for updates from Settings.\n- Filters stay as long as you choose.").assertExists()
        assertEquals(emptyList<String>(), taps.log)
        compose.onNodeWithText("Download").performClick()
        assertEquals(listOf("download"), taps.log)
    }

    @Test
    fun notesAreShownAsPlainTextWithNothingFollowed() {
        val tricky = SampleRelease.copy(notes = "[click](https://example.invalid) **bold** <b>tag</b>")
        show(UpdateState.Available(tricky))
        compose.onNodeWithText("[click](https://example.invalid) **bold** <b>tag</b>").assertExists()
    }

    @Test
    fun aVersionWithoutNotesSaysSo() {
        show(UpdateState.Available(SampleRelease.copy(notes = "")))
        compose.onNodeWithText("No notes were written for this version.").assertExists()
    }

    @Test
    fun downloadingShowsProgressAndCanBeCancelled() {
        val taps = show(UpdateState.Downloading(SampleRelease, 6_291_456))
        compose.onNodeWithText("Downloading 6.0 MB of 12.0 MB").assertExists()
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(listOf("cancel"), taps.log)
    }

    @Test
    fun aVerifiedFileIsInstalledOnlyOnTheButton() {
        val taps = show(UpdateState.Ready(SampleRelease))
        compose.onNodeWithText("Downloaded and checked", substring = true).assertExists()
        compose.onNodeWithText("Android has to allow installs", substring = true).assertDoesNotExist()
        compose.onNodeWithText("Install").performClick()
        assertEquals(listOf("install"), taps.log)
    }

    @Test
    fun whenAndroidMustAllowInstallsTheScreenSaysSo() {
        show(UpdateState.Ready(SampleRelease, needsPermission = true))
        compose.onNodeWithText("Android has to allow installs", substring = true).assertExists()
    }

    @Test
    fun installingWaitsForAndroid() {
        show(UpdateState.Installing(SampleRelease))
        compose.onNodeWithText("Waiting for Android.", substring = true).assertExists()
        compose.onNodeWithText("Install").assertDoesNotExist()
    }

    @Test
    fun everyRefusalIsExplainedAndOffersAFreshDownload() {
        val cases = mapOf(
            Refusal.HashMismatch to "does not match the release",
            Refusal.SizeMismatch to "does not match the release",
            Refusal.Unreadable to "does not match the release",
            Refusal.WrongCertificate to "not signed with Ledgerline's key",
            Refusal.NotNewer to "not a newer version",
            Refusal.WrongPackage to "not a newer version",
        )
        var state by mutableStateOf<UpdateState>(UpdateState.Idle)
        val taps = Taps()
        compose.setContent { UpdateContent("0.1.2", state, taps.actions(), 0.dp, Modifier.requiredHeight(3000.dp)) }
        for ((why, text) in cases) {
            compose.runOnIdle { state = UpdateState.Failed(UpdateProblem.Refused(why), SampleRelease) }
            compose.onNodeWithText(text, substring = true).assertExists()
            compose.onNodeWithText("Try again").performClick()
        }
        assertEquals(List(cases.size) { "download" }, taps.log)
    }

    @Test
    fun aFailedCheckOffersACheckAgainAndNamesTheCause() {
        val taps = show(UpdateState.Failed(UpdateProblem.Offline, null))
        compose.onNodeWithText("There is no connection", substring = true).assertExists()
        compose.onNodeWithText("What's new").assertDoesNotExist()
        compose.onNodeWithText("Try again").performClick()
        assertEquals(listOf("check"), taps.log)
    }

    @Test
    fun theBackLinkReturnsToSettings() {
        val taps = show(UpdateState.Idle)
        compose.onNodeWithText("←  Settings").performClick()
        assertEquals(listOf("back"), taps.log)
    }

    @Test
    fun theNoticeOpensOnATapAndDismissesOnlyOnTheX() {
        val log = mutableListOf<String>()
        compose.setContent { UpdateNotice("0.1.3", onOpen = { log += "open" }, onDismiss = { log += "dismiss" }) }
        compose.onNodeWithContentDescription("Version 0.1.3 is available, See what's new").performClick()
        assertEquals(listOf("open"), log)
        compose.onNodeWithContentDescription("Dismiss the update notice").performClick()
        assertEquals(listOf("open", "dismiss"), log)
    }

    @Test
    fun homeShowsTheBannerAtTheTopOnlyWhenGivenOne() {
        val log = mutableListOf<String>()
        compose.setContent {
            HomeContent(
                header = {}, month = Online.Ready(homeSummary()), onRetry = {}, accounts = Mirrored.Ready(emptyList()), onOpenPending = {},
                banner = { UpdateNotice("0.1.3", { log += "open" }, { log += "dismiss" }) },
                modifier = Modifier.requiredHeight(3000.dp),
            )
        }
        compose.onNodeWithContentDescription("Version 0.1.3 is available, See what's new").assertExists()
        compose.onNodeWithContentDescription("Dismiss the update notice").performClick()
        assertEquals(listOf("dismiss"), log)
    }

    @Test
    fun homeWithoutABannerShowsNone() {
        compose.setContent {
            HomeContent(
                header = {}, month = Online.Ready(homeSummary()), onRetry = {}, accounts = Mirrored.Ready(emptyList()), onOpenPending = {},
                modifier = Modifier.requiredHeight(3000.dp),
            )
        }
        compose.onNodeWithContentDescription("Version 0.1.3 is available, See what's new").assertDoesNotExist()
    }

    @Test
    fun moreShowsTheNoticeAboveItsCardsOnlyWhenGivenOne() {
        compose.setContent {
            MoreContent(MoreActions({}, {}, {}), 0.dp, Modifier.requiredHeight(3000.dp), notice = { UpdateNotice("0.1.3", {}, {}) })
        }
        compose.onNodeWithContentDescription("Version 0.1.3 is available, See what's new").assertExists()
        compose.onNodeWithContentDescription("Settings", substring = true).assertExists()
    }

    @Test
    fun moreWithoutANoticeShowsNone() {
        compose.setContent { MoreContent(MoreActions({}, {}, {}), 0.dp, Modifier.requiredHeight(3000.dp)) }
        compose.onNodeWithContentDescription("Version 0.1.3 is available, See what's new").assertDoesNotExist()
    }
}
