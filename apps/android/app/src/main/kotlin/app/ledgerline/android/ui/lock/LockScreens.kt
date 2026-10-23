package app.ledgerline.android.ui.lock

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import app.ledgerline.android.BuildConfig
import app.ledgerline.android.R
import app.ledgerline.android.session.Protection

@Composable
private fun ScreenColumn(content: @Composable () -> Unit) {
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) { content() }
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
            Text("Debug: $detail", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
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
    ScreenColumn {
        Text(stringResource(R.string.lock_title), style = MaterialTheme.typography.headlineSmall)
        Text(
            stringResource(R.string.lock_body),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Problem(state.problem, state.detail)
        Button(
            shape = MaterialTheme.shapes.small,
            onClick = viewModel::unlock,
            enabled = !state.busy,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) { Text(stringResource(R.string.lock_unlock)) }
        TextButton(shape = MaterialTheme.shapes.small, onClick = viewModel::signInAgain, enabled = !state.busy, modifier = Modifier.heightIn(min = 48.dp)) {
            Text(stringResource(R.string.lock_sign_in_again))
        }
    }
}

/** Right after sign-in: keep the session on this phone behind the fingerprint or screen lock, or not. */
@Composable
fun KeepSignedInScreen(viewModel: LockViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsState()
    val available = viewModel.protection == Protection.Available
    ScreenColumn {
        Text(stringResource(R.string.keep_title), style = MaterialTheme.typography.headlineSmall)
        Text(
            stringResource(
                when (viewModel.protection) {
                    Protection.Available -> R.string.keep_body
                    Protection.NoScreenLock -> R.string.keep_body_no_lock
                    Protection.Unavailable -> R.string.keep_body_unavailable
                },
            ),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Problem(state.problem, state.detail)
        if (available) {
            Button(
                shape = MaterialTheme.shapes.small,
                onClick = viewModel::protect,
                enabled = !state.busy,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.keep_button)) }
            TextButton(shape = MaterialTheme.shapes.small, onClick = viewModel::notNow, enabled = !state.busy, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(R.string.keep_not_now))
            }
        } else {
            Button(
                shape = MaterialTheme.shapes.small,
                onClick = viewModel::notNow,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.keep_continue)) }
        }
    }
}
