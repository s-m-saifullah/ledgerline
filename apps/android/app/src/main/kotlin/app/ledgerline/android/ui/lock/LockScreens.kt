package app.ledgerline.android.ui.lock

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import app.ledgerline.android.BuildConfig
import app.ledgerline.android.R
import app.ledgerline.android.session.Protection
import app.ledgerline.android.ui.design.CardGap
import app.ledgerline.android.ui.design.LinkButton
import app.ledgerline.android.ui.design.PrimaryButton
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.TopBar

/** What the lock screens' buttons do. */
class LockActions(val primary: () -> Unit, val secondary: () -> Unit)

/** A top bar and a column on the app's background, inside the safe area. */
@Composable
private fun LockFrame(title: String, content: @Composable () -> Unit) {
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.safeDrawingPadding().fillMaxSize()) {
            TopBar(title)
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()).padding(horizontal = ScreenMargin, vertical = CardGap),
                verticalArrangement = Arrangement.spacedBy(CardGap),
                horizontalAlignment = Alignment.Start,
            ) { content() }
        }
    }
}

@Composable
private fun Problem(problem: LockProblem?, detail: String?) {
    problem?.let {
        Text(
            stringResource(if (it == LockProblem.LockedOut) R.string.lock_error_locked_out else R.string.lock_error_failed),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.error,
        )
        // A short reason code for testing; release builds show only the sentence above.
        if (BuildConfig.DEBUG && detail != null) {
            Text("Debug: $detail", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun Line(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** A stored session is closed. The system prompt opens once on arrival; Unlock opens it again. */
@Composable
fun LockedScreen(viewModel: LockViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsState()
    var prompted by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        if (!prompted) {
            prompted = true
            viewModel.unlock()
        }
    }
    LockedContent(state, LockActions(viewModel::unlock, viewModel::signInAgain))
}

/** The locked screen as plain data (ADR 0046): a top bar, one line, one Unlock button and a link. */
@Composable
fun LockedContent(state: LockUiState, actions: LockActions) {
    LockFrame(stringResource(R.string.lock_title)) {
        Line(stringResource(R.string.lock_body))
        Problem(state.problem, state.detail)
        PrimaryButton(stringResource(R.string.lock_unlock), actions.primary, Modifier.fillMaxWidth(), enabled = !state.busy)
        LinkButton(stringResource(R.string.lock_sign_in_again), actions.secondary, Modifier.offset(x = (-12).dp), enabled = !state.busy)
    }
}

/** Right after sign-in: keep the session on this phone behind the fingerprint or screen lock, or not. */
@Composable
fun KeepSignedInScreen(viewModel: LockViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsState()
    KeepSignedInContent(state, viewModel.protection, LockActions(viewModel::protect, viewModel::notNow))
}

/** The offer as plain data: one line that depends on what the phone can do, then Use fingerprint or screen lock, or Continue. */
@Composable
fun KeepSignedInContent(state: LockUiState, protection: Protection, actions: LockActions) {
    val available = protection == Protection.Available
    LockFrame(stringResource(R.string.keep_title)) {
        Line(
            stringResource(
                when (protection) {
                    Protection.Available -> R.string.keep_body
                    Protection.NoScreenLock -> R.string.keep_body_no_lock
                    Protection.Unavailable -> R.string.keep_body_unavailable
                },
            ),
        )
        Problem(state.problem, state.detail)
        if (available) {
            PrimaryButton(stringResource(R.string.keep_button), actions.primary, Modifier.fillMaxWidth(), enabled = !state.busy)
            LinkButton(stringResource(R.string.keep_not_now), actions.secondary, Modifier.offset(x = (-12).dp), enabled = !state.busy)
        } else {
            PrimaryButton(stringResource(R.string.keep_continue), actions.secondary, Modifier.fillMaxWidth())
        }
    }
}
