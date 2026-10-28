package app.ledgerline.android.ui.update

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import app.ledgerline.android.BuildConfig
import app.ledgerline.android.R
import app.ledgerline.android.ui.design.CardGap
import app.ledgerline.android.ui.design.CardTitle
import app.ledgerline.android.ui.design.LedgerCard
import app.ledgerline.android.ui.design.GroupedListCard
import app.ledgerline.android.ui.design.RowHeight
import app.ledgerline.android.ui.design.TopBar
import app.ledgerline.android.ui.design.tabular
import app.ledgerline.android.ui.design.PrimaryButton
import app.ledgerline.android.ui.design.SecondaryButton
import app.ledgerline.android.update.Refusal
import app.ledgerline.android.update.Release
import app.ledgerline.android.update.UpdateProblem
import app.ledgerline.android.update.UpdateState
import java.util.Locale

/** What the update screen's buttons do. */
class UpdateActions(
    val onBack: () -> Unit,
    val check: () -> Unit,
    val download: () -> Unit,
    val cancel: () -> Unit,
    val install: () -> Unit,
)

/** The update screen, opened from Settings or a notice. The system Back gesture returns to Settings. */
@Composable
fun UpdateScreen(onBack: () -> Unit, bottomSpace: Dp, modifier: Modifier = Modifier, viewModel: UpdateViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsState()
    BackHandler(onBack = onBack)
    UpdateContent(
        installed = BuildConfig.VERSION_NAME.removeSuffix("-debug"),
        state = state,
        actions = UpdateActions(onBack, viewModel::checkNow, viewModel::download, viewModel::cancel, viewModel::install),
        bottomSpace = bottomSpace,
        modifier = modifier,
    )
}

/** The update screen as plain data (ADR 0045): the installed version, where the update stands, and what the buttons do. */
@Composable
fun UpdateContent(installed: String, state: UpdateState, actions: UpdateActions, bottomSpace: Dp, modifier: Modifier = Modifier) {
    val release = releaseOf(state)
    Column(modifier) {
        TopBar(stringResource(R.string.updates_title), onBack = actions.onBack)
        UpdateList(installed, state, release, actions, bottomSpace)
    }
}

@Composable
private fun UpdateList(installed: String, state: UpdateState, release: Release?, actions: UpdateActions, bottomSpace: Dp) {
    LazyColumn(contentPadding = PaddingValues(top = CardGap, bottom = bottomSpace), verticalArrangement = Arrangement.spacedBy(CardGap)) {
        item {
            GroupedListCard {
                row {
                    Row(
                        modifier = Modifier.fillMaxWidth().heightIn(min = RowHeight).padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(stringResource(R.string.updates_installed), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                        Text(installed, style = MaterialTheme.typography.titleMedium.tabular())
                    }
                }
            }
        }
        item {
            LedgerCard {
                when (state) {
                    UpdateState.Idle -> Idle(actions)
                    UpdateState.Checking -> Line(stringResource(R.string.updates_checking))
                    UpdateState.UpToDate -> {
                        Line(stringResource(R.string.updates_up_to_date))
                        Buttons { SecondaryButton(stringResource(R.string.updates_check_again), actions.check) }
                    }
                    is UpdateState.Available -> {
                        Title(state.release)
                        Buttons { PrimaryButton(stringResource(R.string.updates_download), actions.download) }
                    }
                    is UpdateState.Downloading -> {
                        Title(state.release)
                        Progress(state.received, state.release.apkSize)
                        Buttons { SecondaryButton(stringResource(R.string.updates_cancel), actions.cancel) }
                    }
                    is UpdateState.Ready -> {
                        Title(state.release)
                        Line(stringResource(R.string.updates_ready))
                        if (state.needsPermission) Line(stringResource(R.string.updates_needs_permission))
                        Buttons { PrimaryButton(stringResource(R.string.updates_install), actions.install) }
                    }
                    is UpdateState.Installing -> {
                        Title(state.release)
                        Line(stringResource(R.string.updates_installing))
                    }
                    is UpdateState.Failed -> {
                        if (state.release != null) Title(state.release)
                        Line(stringResource(problemText(state.problem)), error = true)
                        Buttons {
                            // With a release the failure is the download or install, so retrying means downloading again.
                            SecondaryButton(stringResource(R.string.updates_try_again), if (state.release != null) actions.download else actions.check)
                        }
                    }
                }
            }
        }
        if (release != null) {
            item {
                LedgerCard {
                    CardTitle(stringResource(R.string.updates_whats_new), release.name)
                    Text(
                        release.notes.ifBlank { stringResource(R.string.updates_no_notes) },
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                }
            }
        }
    }
}

private fun releaseOf(state: UpdateState): Release? = when (state) {
    is UpdateState.Available -> state.release
    is UpdateState.Downloading -> state.release
    is UpdateState.Ready -> state.release
    is UpdateState.Installing -> state.release
    is UpdateState.Failed -> state.release
    else -> null
}

private fun problemText(problem: UpdateProblem): Int = when (problem) {
    UpdateProblem.Offline -> R.string.updates_offline
    UpdateProblem.ServerError -> R.string.updates_server_error
    UpdateProblem.InstallFailed -> R.string.updates_install_failed
    is UpdateProblem.Refused -> when (problem.why) {
        Refusal.WrongCertificate -> R.string.updates_refused_key
        Refusal.NotNewer, Refusal.WrongVersion, Refusal.WrongPackage -> R.string.updates_refused_old
        Refusal.SizeMismatch, Refusal.HashFileInvalid, Refusal.HashMismatch, Refusal.Unreadable -> R.string.updates_refused_damaged
    }
}

@Composable
private fun Idle(actions: UpdateActions) {
    Buttons { PrimaryButton(stringResource(R.string.updates_check), actions.check) }
}

@Composable
private fun Title(release: Release) {
    val title = if (release.apkSize > 0) {
        stringResource(R.string.updates_available_size, release.name, megabytes(release.apkSize))
    } else {
        stringResource(R.string.updates_available, release.name)
    }
    Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
}

@Composable
private fun Line(text: String, error: Boolean = false) {
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = if (error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
        modifier = Modifier.padding(top = 8.dp),
    )
}

@Composable
private fun Progress(received: Long, total: Long) {
    val text = if (total > 0) {
        stringResource(R.string.updates_downloading_of, megabytes(received), megabytes(total))
    } else {
        stringResource(R.string.updates_downloading)
    }
    Line(text)
    if (total > 0) {
        LinearProgressIndicator(progress = { (received.toFloat() / total).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
    } else {
        LinearProgressIndicator(modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
    }
}

@Composable
private fun Buttons(content: @Composable () -> Unit) {
    Column(modifier = Modifier.padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
}

/** "12.3 MB", one decimal and a dot whatever the phone's language, as a size (not money). */
internal fun megabytes(bytes: Long): String = String.format(Locale.ROOT, "%.1f MB", bytes / (1024.0 * 1024.0))
