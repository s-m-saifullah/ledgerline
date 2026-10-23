package app.ledgerline.android.ui.settings

import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import app.ledgerline.android.BuildConfig
import app.ledgerline.android.R
import app.ledgerline.android.settings.PhoneSettings
import app.ledgerline.android.settings.ThemeChoice
import app.ledgerline.android.ui.design.BackLink
import app.ledgerline.android.ui.design.CardGap
import app.ledgerline.android.ui.design.CardTitle
import app.ledgerline.android.ui.design.LedgerCard
import app.ledgerline.android.ui.design.PageHeader
import app.ledgerline.android.ui.design.SecondaryButton
import app.ledgerline.android.ui.home.SignedInViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject

/** The phone's own choices (ADR 0043, slice 5 and the polish after it): theme, privacy, amount entry, screenshots. */
@HiltViewModel
class SettingsViewModel @Inject constructor(private val settings: PhoneSettings) : ViewModel() {
    val theme: StateFlow<ThemeChoice> = settings.theme
    val privacyMode: StateFlow<Boolean> = settings.privacyMode
    val centsFirst: StateFlow<Boolean> = settings.centsFirst
    val allowScreenshots: StateFlow<Boolean> = settings.allowScreenshots

    fun setTheme(choice: ThemeChoice) = settings.setTheme(choice)

    fun setPrivacyMode(on: Boolean) = settings.setPrivacyMode(on)

    fun setCentsFirst(on: Boolean) = settings.setCentsFirst(on)

    fun setAllowScreenshots(allow: Boolean) = settings.setAllowScreenshots(allow)
}

/** Everything Settings shows, as plain data. */
data class SettingsState(
    val theme: ThemeChoice,
    val hideAmounts: Boolean,
    val centsFirst: Boolean,
    val allowScreenshots: Boolean,
    val unsent: Int,
    val attention: Int,
    val canLock: Boolean,
    val signingOut: Boolean,
)

/** What Settings' buttons, choices and switches do. */
class SettingsActions(
    val onBack: () -> Unit,
    val setTheme: (ThemeChoice) -> Unit,
    val setHideAmounts: (Boolean) -> Unit,
    val setCentsFirst: (Boolean) -> Unit,
    val setAllowScreenshots: (Boolean) -> Unit,
    val openAttention: () -> Unit,
    val refreshEverything: () -> Unit,
    val lock: () -> Unit,
    val signOut: () -> Unit,
)

/** Settings, opened from More. The system Back gesture returns to More. */
@Composable
fun SettingsScreen(
    signedIn: SignedInViewModel,
    openAttention: () -> Unit,
    onBack: () -> Unit,
    bottomSpace: Dp,
    modifier: Modifier = Modifier,
    settings: SettingsViewModel = hiltViewModel(),
) {
    val theme by settings.theme.collectAsState()
    val hide by settings.privacyMode.collectAsState()
    val centsFirst by settings.centsFirst.collectAsState()
    val screenshots by settings.allowScreenshots.collectAsState()
    val unsent by signedIn.unsent.collectAsState()
    val attention by signedIn.attention.collectAsState()
    val signingOut by signedIn.signingOut.collectAsState()
    BackHandler(onBack = onBack)
    SettingsContent(
        SettingsState(theme, hide, centsFirst, screenshots, unsent, attention.size, signedIn.canLock, signingOut),
        SettingsActions(
            onBack,
            settings::setTheme,
            settings::setPrivacyMode,
            settings::setCentsFirst,
            settings::setAllowScreenshots,
            openAttention,
            signedIn::refreshEverything,
            signedIn::lock,
            signedIn::signOut,
        ),
        bottomSpace,
        modifier,
    )
}

/** Settings as the web's Settings page (ADR 0045): a header, then one card per group. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SettingsContent(state: SettingsState, actions: SettingsActions, bottomSpace: Dp, modifier: Modifier = Modifier) {
    LazyColumn(modifier = modifier, contentPadding = PaddingValues(bottom = bottomSpace), verticalArrangement = Arrangement.spacedBy(CardGap)) {
        item { BackLink(stringResource(R.string.back_more), actions.onBack) }
        item {
            PageHeader(
                stringResource(R.string.settings_title),
                eyebrow = stringResource(R.string.eyebrow_yours),
                subtitle = stringResource(R.string.settings_subtitle),
            )
        }
        item {
            LedgerCard {
                CardTitle(stringResource(R.string.settings_appearance), stringResource(R.string.settings_this_phone))
                Text(
                    stringResource(R.string.theme_title),
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.padding(top = 12.dp).semantics { heading() },
                )
                Column(modifier = Modifier.selectableGroup()) {
                    ThemeRow(R.string.theme_light, state.theme == ThemeChoice.Light) { actions.setTheme(ThemeChoice.Light) }
                    ThemeRow(R.string.theme_dark, state.theme == ThemeChoice.Dark) { actions.setTheme(ThemeChoice.Dark) }
                    ThemeRow(R.string.theme_system, state.theme == ThemeChoice.System) { actions.setTheme(ThemeChoice.System) }
                }
                Muted(stringResource(R.string.theme_detail))
            }
        }
        item {
            LedgerCard {
                CardTitle(stringResource(R.string.settings_privacy), stringResource(R.string.settings_this_phone))
                SwitchRow(R.string.privacy_mode, R.string.privacy_mode_detail, state.hideAmounts, actions.setHideAmounts)
                SwitchRow(R.string.cents_first, R.string.cents_first_detail, state.centsFirst, actions.setCentsFirst)
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
                    Muted(stringResource(R.string.about_version, BuildConfig.VERSION_NAME), top = 0.dp)
                    Muted(stringResource(R.string.about_api, BuildConfig.API_VERSION), top = 0.dp)
                }
            }
        }
    }
}

@Composable
private fun Muted(text: String, top: Dp = 8.dp) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = top))
}

/** The whole row is the radio button: one 48 dp target that a screen reader announces as a radio button. */
@Composable
private fun ThemeRow(label: Int, selected: Boolean, onSelect: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .selectable(selected = selected, role = Role.RadioButton, onClick = onSelect)
            .heightIn(min = 48.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = null)
        Text(stringResource(label), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(start = 12.dp))
    }
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
            Muted(stringResource(detail), top = 0.dp)
        }
        Switch(checked = checked, onCheckedChange = null)
    }
}
