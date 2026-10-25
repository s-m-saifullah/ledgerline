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
import androidx.compose.ui.semantics.contentDescription
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
import app.ledgerline.android.ui.design.CardGap
import app.ledgerline.android.ui.design.GroupedListCard
import app.ledgerline.android.ui.design.GroupedRows
import app.ledgerline.android.ui.design.RowHeight
import app.ledgerline.android.ui.design.SecondaryButton
import app.ledgerline.android.ui.design.SectionLabel
import app.ledgerline.android.ui.design.SegmentedControl
import app.ledgerline.android.ui.design.TopBar
import app.ledgerline.android.ui.home.SyncLine
import app.ledgerline.android.ui.home.SyncProblem
import app.ledgerline.android.ui.theme.LocalPalette
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import app.ledgerline.android.ui.home.SignedInViewModel
import app.ledgerline.android.ui.update.UpdateViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.input.KeyboardType
import app.ledgerline.android.settings.FilterKeep
import app.ledgerline.android.settings.KeepMode
import app.ledgerline.android.settings.KeepUnit
import app.ledgerline.android.ui.design.ChoiceField
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject

/** The phone's own choices (ADR 0043, slice 5 and the polish after it): theme, privacy, amount entry, screenshots. */
@HiltViewModel
class SettingsViewModel @Inject constructor(private val settings: PhoneSettings) : ViewModel() {
    val theme: StateFlow<ThemeChoice> = settings.theme
    val privacyMode: StateFlow<Boolean> = settings.privacyMode
    val centsFirst: StateFlow<Boolean> = settings.centsFirst
    val allowScreenshots: StateFlow<Boolean> = settings.allowScreenshots
    val filterKeep: StateFlow<FilterKeep> = settings.filterKeep
    val autoUpdateCheck: StateFlow<Boolean> = settings.autoUpdateCheck

    fun setTheme(choice: ThemeChoice) = settings.setTheme(choice)

    fun setPrivacyMode(on: Boolean) = settings.setPrivacyMode(on)

    fun setCentsFirst(on: Boolean) = settings.setCentsFirst(on)

    fun setAllowScreenshots(allow: Boolean) = settings.setAllowScreenshots(allow)

    fun setFilterKeep(keep: FilterKeep) = settings.setFilterKeep(keep)

    fun setAutoUpdateCheck(on: Boolean) = settings.setAutoUpdateCheck(on)
}

/** Everything Settings shows, as plain data. */
data class SettingsState(
    val theme: ThemeChoice,
    val hideAmounts: Boolean,
    val centsFirst: Boolean,
    val allowScreenshots: Boolean,
    val filterKeep: FilterKeep,
    val updates: UpdatesInfo?,
    val unsent: Int,
    val attention: Int,
    val canLock: Boolean,
    val signingOut: Boolean,
    val pill: SyncPill,
)

/** The one word in Settings' top bar that says how syncing stands (ADR 0046); the Sync section has the details. */
enum class SyncPill { Synced, Updating, Offline, Failed, NotSent }

/** Running first, then a problem, then changes not sent yet; otherwise everything is in order. */
fun syncPill(line: SyncLine, unsent: Int): SyncPill = when {
    line.running -> SyncPill.Updating
    line.problem == SyncProblem.Offline -> SyncPill.Offline
    line.problem == SyncProblem.Failed -> SyncPill.Failed
    unsent > 0 -> SyncPill.NotSent
    else -> SyncPill.Synced
}

enum class AccountAction { Lock, SignOut }

/** One button of the Account section: Sign out is the red one and waits while it is signing out; Lock now only where locking exists. */
data class AccountRow(val action: AccountAction, val danger: Boolean, val enabled: Boolean)

fun accountActions(canLock: Boolean, signingOut: Boolean): List<AccountRow> =
    listOfNotNull(
        if (canLock) AccountRow(AccountAction.Lock, danger = false, enabled = true) else null,
        AccountRow(AccountAction.SignOut, danger = true, enabled = !signingOut),
    )

/** What the Updates card shows: whether the owner wants automatic checks and the newer version already known, if any. */
data class UpdatesInfo(val auto: Boolean, val newVersion: String?)

/** What Settings' buttons, choices and switches do. */
class SettingsActions(
    val onBack: () -> Unit,
    val setTheme: (ThemeChoice) -> Unit,
    val setHideAmounts: (Boolean) -> Unit,
    val setCentsFirst: (Boolean) -> Unit,
    val setAllowScreenshots: (Boolean) -> Unit,
    val setFilterKeep: (FilterKeep) -> Unit,
    val setAutoUpdate: (Boolean) -> Unit,
    val openUpdates: () -> Unit,
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
    openUpdates: () -> Unit,
    onBack: () -> Unit,
    bottomSpace: Dp,
    modifier: Modifier = Modifier,
    settings: SettingsViewModel = hiltViewModel(),
    update: UpdateViewModel = hiltViewModel(),
) {
    val theme by settings.theme.collectAsState()
    val hide by settings.privacyMode.collectAsState()
    val centsFirst by settings.centsFirst.collectAsState()
    val screenshots by settings.allowScreenshots.collectAsState()
    val filterKeep by settings.filterKeep.collectAsState()
    val auto by settings.autoUpdateCheck.collectAsState()
    val newer by update.newer.collectAsState()
    val unsent by signedIn.unsent.collectAsState()
    val attention by signedIn.attention.collectAsState()
    val signingOut by signedIn.signingOut.collectAsState()
    val line by signedIn.syncLine.collectAsState()
    BackHandler(onBack = onBack)
    SettingsContent(
        SettingsState(theme, hide, centsFirst, screenshots, filterKeep, if (update.enabled) UpdatesInfo(auto, newer?.name) else null, unsent, attention.size, signedIn.canLock, signingOut, syncPill(line, unsent)),
        SettingsActions(
            onBack,
            settings::setTheme,
            settings::setPrivacyMode,
            settings::setCentsFirst,
            settings::setAllowScreenshots,
            settings::setFilterKeep,
            settings::setAutoUpdateCheck,
            openUpdates,
            openAttention,
            signedIn::refreshEverything,
            signedIn::lock,
            signedIn::signOut,
        ),
        bottomSpace,
        modifier,
    )
}

/** Settings (ADR 0046): a fixed top bar with the sync pill, then grouped sections; every control that existed stays. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SettingsContent(state: SettingsState, actions: SettingsActions, bottomSpace: Dp, modifier: Modifier = Modifier) {
    Column(modifier = modifier) {
        TopBar(stringResource(R.string.settings_title), onBack = actions.onBack, action = { SyncPillView(state.pill) })
        LazyColumn(contentPadding = PaddingValues(bottom = bottomSpace), verticalArrangement = Arrangement.spacedBy(CardGap)) {
            item {
                Section(R.string.settings_appearance) {
                    row {
                        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Column {
                                Text(stringResource(R.string.theme_title), style = MaterialTheme.typography.titleMedium)
                                Muted(stringResource(R.string.theme_detail), top = 0.dp)
                            }
                            val choices = listOf(ThemeChoice.Light, ThemeChoice.Dark, ThemeChoice.System)
                            SegmentedControl(
                                options = listOf(stringResource(R.string.theme_light), stringResource(R.string.theme_dark), stringResource(R.string.theme_system)),
                                selected = choices.indexOf(state.theme),
                                onSelect = { actions.setTheme(choices[it]) },
                            )
                        }
                    }
                }
            }
            item {
                Section(R.string.settings_privacy) {
                    row { SwitchRow(R.string.privacy_mode, R.string.privacy_mode_detail, state.hideAmounts, actions.setHideAmounts) }
                    row { SwitchRow(R.string.cents_first, R.string.cents_first_detail, state.centsFirst, actions.setCentsFirst) }
                    row { SwitchRow(R.string.allow_screenshots, R.string.allow_screenshots_detail, state.allowScreenshots, actions.setAllowScreenshots) }
                    row { KeepFilters(state.filterKeep, actions.setFilterKeep) }
                }
            }
            item {
                Section(R.string.settings_sync) {
                    row {
                        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text(
                                if (state.unsent == 0) stringResource(R.string.all_sent) else pluralStringResource(R.plurals.unsent_count, state.unsent, state.unsent),
                                style = MaterialTheme.typography.bodyLarge,
                            )
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
            }
            item {
                Section(R.string.settings_session) {
                    row {
                        // Wraps onto a second line with large text instead of squeezing a button's label.
                        FlowRow(
                            modifier = Modifier.padding(16.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            accountActions(state.canLock, state.signingOut).forEach { account ->
                                when (account.action) {
                                    AccountAction.Lock -> SecondaryButton(stringResource(R.string.lock_now), onClick = actions.lock, enabled = account.enabled, danger = account.danger)
                                    AccountAction.SignOut -> SecondaryButton(stringResource(R.string.sign_out), onClick = actions.signOut, enabled = account.enabled, danger = account.danger)
                                }
                            }
                        }
                    }
                }
            }
            item {
                Section(R.string.settings_about) {
                    state.updates?.let { updates -> row { UpdatesRows(updates, actions) } }
                    row {
                        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Muted(stringResource(R.string.about_version, BuildConfig.VERSION_NAME), top = 0.dp)
                            Muted(stringResource(R.string.about_api, BuildConfig.API_VERSION), top = 0.dp)
                        }
                    }
                }
            }
        }
    }
}

/** A labelled group of rows in one bordered card. */
@Composable
private fun Section(label: Int, rows: GroupedRows.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionLabel(stringResource(label))
        GroupedListCard(rows = rows)
    }
}

/** A dot and one word for the sync state; the dot is only an extra cue. */
@Composable
private fun SyncPillView(pill: SyncPill) {
    val palette = LocalPalette.current
    val (word, dot) = when (pill) {
        SyncPill.Synced -> R.string.sync_pill_synced to palette.accent
        SyncPill.Updating -> R.string.sync_pill_running to palette.muted
        SyncPill.Offline -> R.string.sync_pill_offline to palette.muted
        SyncPill.Failed -> R.string.sync_pill_failed to palette.danger
        SyncPill.NotSent -> R.string.sync_pill_unsent to palette.muted
    }
    Row(
        modifier = Modifier.heightIn(min = 32.dp).border(1.dp, palette.border, CircleShape).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.size(8.dp).background(dot, CircleShape))
        Text(stringResource(word), style = MaterialTheme.typography.labelLarge)
    }
}

/** Updates: the newer version if one is known, the automatic-check switch and the button that opens the update screen (ADR 0043). */
@Composable
private fun UpdatesRows(updates: UpdatesInfo, actions: SettingsActions) {
    Column {
        if (updates.newVersion != null) {
            Text(
                stringResource(R.string.updates_available, updates.newVersion),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp),
            )
        }
        SwitchRow(R.string.updates_auto, R.string.updates_auto_detail, updates.auto, actions.setAutoUpdate)
        SecondaryButton(
            stringResource(R.string.updates_check),
            onClick = actions.openUpdates,
            modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 16.dp),
        )
    }
}

/**
 * How long the Transactions filters stay: until the owner leaves Transactions, until the app closes (as before), or for
 * a number of minutes, hours or days, which also survives closing the app. The number is saved only when it is valid.
 */
@Composable
private fun KeepFilters(keep: FilterKeep, onChange: (FilterKeep) -> Unit) {
    Column(modifier = Modifier.padding(16.dp)) {
        Text(
            stringResource(R.string.filters_keep_title),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.semantics { heading() },
        )
        Column(modifier = Modifier.selectableGroup()) {
            KeepRow(R.string.filters_keep_leave, keep.mode == KeepMode.UntilLeave) { onChange(keep.copy(mode = KeepMode.UntilLeave)) }
            KeepRow(R.string.filters_keep_app, keep.mode == KeepMode.UntilAppCloses) { onChange(keep.copy(mode = KeepMode.UntilAppCloses)) }
            KeepRow(R.string.filters_keep_for, keep.mode == KeepMode.ForAWhile) { onChange(keep.copy(mode = KeepMode.ForAWhile)) }
        }
        if (keep.mode == KeepMode.ForAWhile) {
            var text by remember(keep.amount) { mutableStateOf(keep.amount.toString()) }
            val numberLabel = stringResource(R.string.filters_keep_number)
            val amount = FilterKeep.amountOf(text)
            Row(modifier = Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                // The same layout as the unit box beside it: the label above, a box of the same height under it.
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.filters_keep_number), style = MaterialTheme.typography.bodyMedium)
                    OutlinedTextField(
                        value = text,
                        onValueChange = { typed ->
                            text = typed.filter { it.isDigit() }.take(3)
                            FilterKeep.amountOf(text)?.let { onChange(keep.copy(amount = it)) }
                        },
                        isError = amount == null,
                        supportingText = if (amount == null) ({ Text(stringResource(R.string.filters_keep_invalid)) }) else null,
                        singleLine = true,
                        shape = MaterialTheme.shapes.small,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth().semantics { contentDescription = numberLabel },
                    )
                }
                ChoiceField(
                    label = stringResource(R.string.filters_keep_unit),
                    // "1 Hour", "2 Hours": the unit follows the number in the box.
                    options = KeepUnit.entries.map { it.name to pluralStringResource(it.label(), amount ?: keep.amount) },
                    selected = keep.unit.name,
                    onSelect = { name -> onChange(keep.copy(unit = KeepUnit.valueOf(name))) },
                    modifier = Modifier.weight(1f),
                    minHeight = 56.dp,
                )
            }
        }
        Muted(stringResource(R.string.filters_keep_detail))
    }
}

private fun KeepUnit.label() = when (this) {
    KeepUnit.Minutes -> R.plurals.filters_keep_minutes
    KeepUnit.Hours -> R.plurals.filters_keep_hours
    KeepUnit.Days -> R.plurals.filters_keep_days
}

@Composable
private fun KeepRow(label: Int, selected: Boolean, onSelect: () -> Unit) = ThemeRow(label, selected, onSelect)

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
            .heightIn(min = RowHeight)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f).padding(end = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(stringResource(title), style = MaterialTheme.typography.titleMedium)
            Muted(stringResource(detail), top = 0.dp)
        }
        Switch(checked = checked, onCheckedChange = null)
    }
}
