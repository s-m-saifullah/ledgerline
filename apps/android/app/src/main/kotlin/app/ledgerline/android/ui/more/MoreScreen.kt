package app.ledgerline.android.ui.more

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import app.ledgerline.android.BuildConfig
import app.ledgerline.android.R
import app.ledgerline.android.settings.PhoneSettings
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

/** More: privacy, what is waiting to be sent, the session, and which version this is. */
@Composable
fun MoreScreen(
    signedIn: SignedInViewModel,
    openAttention: () -> Unit,
    bottomSpace: Dp,
    more: MoreViewModel = hiltViewModel(),
) {
    val privacy by more.privacyMode.collectAsState()
    val screenshots by more.allowScreenshots.collectAsState()
    val unsent by signedIn.unsent.collectAsState()
    val attention by signedIn.attention.collectAsState()
    val signingOut by signedIn.signingOut.collectAsState()
    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = bottomSpace)) {
        item { Heading(R.string.settings_privacy) }
        item {
            SwitchRow(R.string.privacy_mode, R.string.privacy_mode_detail, privacy, more::setPrivacyMode)
        }
        item {
            SwitchRow(R.string.allow_screenshots, R.string.allow_screenshots_detail, screenshots, more::setAllowScreenshots)
        }
        item { Heading(R.string.settings_sync) }
        item {
            ListItem(
                headlineContent = {
                    Text(if (unsent == 0) stringResource(R.string.all_sent) else pluralStringResource(R.plurals.unsent_count, unsent, unsent))
                },
            )
        }
        if (attention.isNotEmpty()) {
            item {
                OutlinedButton(
                    onClick = openAttention,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).heightIn(min = 48.dp),
                ) { Text(pluralStringResource(R.plurals.attention_banner, attention.size, attention.size)) }
            }
        }
        item { ActionRow(R.string.refresh_everything, onClick = signedIn::refreshEverything) }
        item { Heading(R.string.settings_session) }
        if (signedIn.canLock) {
            item { ActionRow(R.string.lock_now, onClick = signedIn::lock) }
        }
        item { ActionRow(R.string.sign_out, enabled = !signingOut, onClick = signedIn::signOut) }
        item { Heading(R.string.settings_about) }
        item { ListItem(headlineContent = { Text(stringResource(R.string.about_version, BuildConfig.VERSION_NAME)) }) }
        item { ListItem(headlineContent = { Text(stringResource(R.string.about_api, BuildConfig.API_VERSION)) }) }
    }
}

@Composable
private fun Heading(text: Int) {
    Text(
        stringResource(text),
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 8.dp).semantics { heading() },
    )
}

/** The whole row is the switch, so it is one 48 dp target that a screen reader announces as a switch. */
@Composable
private fun SwitchRow(title: Int, detail: Int, checked: Boolean, onChange: (Boolean) -> Unit) {
    ListItem(
        headlineContent = { Text(stringResource(title)) },
        supportingContent = { Text(stringResource(detail)) },
        trailingContent = { Switch(checked = checked, onCheckedChange = null) },
        modifier = Modifier.toggleable(value = checked, role = Role.Switch, onValueChange = onChange).heightIn(min = 48.dp),
    )
}

@Composable
private fun ActionRow(text: Int, enabled: Boolean = true, onClick: () -> Unit) {
    ListItem(
        headlineContent = {
            Text(
                stringResource(text),
                color = if (enabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        modifier = Modifier.clickable(enabled = enabled, role = Role.Button, onClick = onClick).heightIn(min = 48.dp),
    )
}
