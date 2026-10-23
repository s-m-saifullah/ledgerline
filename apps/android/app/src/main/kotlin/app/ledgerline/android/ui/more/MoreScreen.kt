package app.ledgerline.android.ui.more

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import app.ledgerline.android.BuildConfig
import app.ledgerline.android.R
import app.ledgerline.android.settings.PhoneSettings
import app.ledgerline.android.ui.design.CardGap
import app.ledgerline.android.ui.design.CardTitle
import app.ledgerline.android.ui.design.LedgerCard
import app.ledgerline.android.ui.design.PageHeader
import app.ledgerline.android.ui.design.SecondaryButton
import app.ledgerline.android.ui.home.SignedInViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject

/** The phone's own choices (ADR 0043, slice 5): privacy mode and whether screenshots are allowed. */
@HiltViewModel
class MoreViewModel @Inject constructor(private val settings: PhoneSettings) : ViewModel() {
    val privacyMode: StateFlow<Boolean> = settings.privacyMode
    val allowScreenshots: StateFlow<Boolean> = settings.allowScreenshots

    fun setPrivacyMode(on: Boolean) = settings.setPrivacyMode(on)

    fun setAllowScreenshots(allow: Boolean) = settings.setAllowScreenshots(allow)
}

/** Everything More shows, as plain data. */
data class MoreState(
    val hideAmounts: Boolean,
    val allowScreenshots: Boolean,
    val unsent: Int,
    val attention: Int,
    val canLock: Boolean,
    val signingOut: Boolean,
)

/** What More's buttons and switches do. */
class MoreActions(
    val setHideAmounts: (Boolean) -> Unit,
    val setAllowScreenshots: (Boolean) -> Unit,
    val openAttention: () -> Unit,
    val refreshEverything: () -> Unit,
    val lock: () -> Unit,
    val signOut: () -> Unit,
)

@Composable
fun MoreScreen(signedIn: SignedInViewModel, openAttention: () -> Unit, bottomSpace: Dp, modifier: Modifier = Modifier, more: MoreViewModel = hiltViewModel()) {
    val hide by more.privacyMode.collectAsState()
    val screenshots by more.allowScreenshots.collectAsState()
    val unsent by signedIn.unsent.collectAsState()
    val attention by signedIn.attention.collectAsState()
    val signingOut by signedIn.signingOut.collectAsState()
    MoreContent(
        MoreState(hide, screenshots, unsent, attention.size, signedIn.canLock, signingOut),
        MoreActions(more::setPrivacyMode, more::setAllowScreenshots, openAttention, signedIn::refreshEverything, signedIn::lock, signedIn::signOut),
        bottomSpace,
        modifier,
    )
}

/** More as the web's Settings page (ADR 0045): a header, then one card per group. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MoreContent(state: MoreState, actions: MoreActions, bottomSpace: Dp, modifier: Modifier = Modifier) {
    LazyColumn(modifier = modifier, contentPadding = PaddingValues(bottom = bottomSpace), verticalArrangement = Arrangement.spacedBy(CardGap)) {
        item {
            PageHeader(
                stringResource(R.string.more_title),
                eyebrow = stringResource(R.string.eyebrow_yours),
                subtitle = stringResource(R.string.more_subtitle),
            )
        }
        item {
            LedgerCard {
                CardTitle(stringResource(R.string.settings_privacy), stringResource(R.string.settings_this_phone))
                SwitchRow(R.string.privacy_mode, R.string.privacy_mode_detail, state.hideAmounts, actions.setHideAmounts)
                SwitchRow(R.string.allow_screenshots, R.string.allow_screenshots_detail, state.allowScreenshots, actions.setAllowScreenshots)
            }
        }
        item {
            LedgerCard {
                CardTitle(stringResource(R.string.settings_sync), stringResource(R.string.settings_this_phone))
                Text(
                    if (state.unsent == 0) stringResource(R.string.all_sent) else pluralStringResource(R.plurals.unsent_count, state.unsent, state.unsent),
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(top = 12.dp),
                )
                Column(modifier = Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (state.attention > 0) {
                        SecondaryButton(
                            pluralStringResource(R.plurals.attention_banner, state.attention, state.attention),
                            onClick = actions.openAttention,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    SecondaryButton(stringResource(R.string.refresh_everything), onClick = actions.refreshEverything)
                }
            }
        }
        item {
            LedgerCard {
                CardTitle(stringResource(R.string.settings_session))
                // Wraps onto a second line with large text instead of squeezing a button's label.
                FlowRow(modifier = Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (state.canLock) SecondaryButton(stringResource(R.string.lock_now), onClick = actions.lock)
                    SecondaryButton(stringResource(R.string.sign_out), onClick = actions.signOut, enabled = !state.signingOut)
                }
            }
        }
        item {
            LedgerCard {
                CardTitle(stringResource(R.string.settings_about))
                Column(modifier = Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Muted(stringResource(R.string.about_version, BuildConfig.VERSION_NAME))
                    Muted(stringResource(R.string.about_api, BuildConfig.API_VERSION))
                }
            }
        }
    }
}

@Composable
private fun Muted(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** The whole row is the switch, so it is one 48 dp target that a screen reader announces as a switch. */
@Composable
private fun SwitchRow(title: Int, detail: Int, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .toggleable(value = checked, role = Role.Switch, onValueChange = onChange)
            .heightIn(min = 48.dp)
            .padding(top = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f).padding(end = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(stringResource(title), style = MaterialTheme.typography.bodyLarge)
            Muted(stringResource(detail))
        }
        Switch(checked = checked, onCheckedChange = null)
    }
}
