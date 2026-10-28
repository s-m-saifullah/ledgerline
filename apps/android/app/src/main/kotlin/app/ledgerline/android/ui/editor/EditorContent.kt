package app.ledgerline.android.ui.editor

import android.text.format.DateFormat
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TimePickerDialog
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.ui.design.EmptyState
import app.ledgerline.android.ui.design.GroupedListCard
import app.ledgerline.android.ui.design.LinkButton
import app.ledgerline.android.ui.design.PrimaryButton
import app.ledgerline.android.ui.design.RowHeight
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SegmentedControl
import app.ledgerline.android.ui.design.TouchTarget
import app.ledgerline.android.ui.format.formatEntryDate
import app.ledgerline.android.ui.theme.LocalPalette
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset

/** What the editor's buttons and fields do, so its content stays a function of plain data. */
class EditorActions(
    val update: ((EditorForm) -> EditorForm) -> Unit,
    val save: () -> Unit,
    val delete: () -> Unit,
    val close: () -> Unit,
    val toggleNewCategory: () -> Unit,
    val setNewCategoryName: (String) -> Unit,
    val createCategory: () -> Unit,
)

/**
 * The editor as plain data (ADR 0046): a top bar (Cancel, the title, a red trash icon for an entry that exists), the
 * type, the big amount, one card for who, where and when, one for tags, the note and Pending, and one Save button
 * pinned at the bottom. A transfer shows From and To with a swap between them. [state] is null while it loads.
 */
@Composable
internal fun EditorContent(state: EditorState?, newCategory: NewCategory?, title: Int, actions: EditorActions, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxSize()) {
        EditorTopBar(stringResource(title), canDelete = state != null && state.canDelete && state.readOnly == null, transfer = state?.form?.mode == EntryMode.Transfer, actions)
        Box(Modifier.weight(1f)) {
            when {
                state == null -> Unit
                state.readOnly != null -> EmptyState(stringResource(state.readOnly.text()), stringResource(R.string.back) to actions.close)
                else -> EditorBody(state, newCategory, actions)
            }
        }
        if (state != null && state.readOnly == null) SaveBar(state, actions)
    }
}

private fun ReadOnly.text() = when (this) {
    ReadOnly.Split -> R.string.editor_readonly_split
    ReadOnly.Linked -> R.string.editor_readonly_linked
    ReadOnly.TransferExtras -> R.string.editor_readonly_transfer
    ReadOnly.Gone -> R.string.editor_readonly_gone
}

@Composable
private fun EditorTopBar(title: String, canDelete: Boolean, transfer: Boolean, actions: EditorActions) {
    var confirming by rememberSaveable { mutableStateOf(false) }
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LinkButton(stringResource(R.string.cancel), actions.close)
        Text(
            title,
            style = MaterialTheme.typography.titleLarge,
            textAlign = TextAlign.Center,
            maxLines = 2,
            modifier = Modifier.weight(1f).padding(horizontal = 4.dp),
        )
        if (canDelete) {
            val delete = stringResource(R.string.editor_delete)
            IconButton(onClick = { confirming = true }, modifier = Modifier.size(TouchTarget).semantics { contentDescription = delete }) {
                Icon(painterResource(R.drawable.ic_trash), contentDescription = null, tint = LocalPalette.current.danger)
            }
        } else {
            // Keeps the title centred.
            Box(Modifier.size(TouchTarget))
        }
    }
    if (confirming) DeleteQuestion(transfer, onDismiss = { confirming = false }, onConfirm = { confirming = false; actions.delete() })
}

@Composable
private fun DeleteQuestion(transfer: Boolean, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(if (transfer) R.string.editor_delete_transfer_title else R.string.editor_delete_entry_title)) },
        text = { Text(stringResource(R.string.editor_delete_body)) },
        confirmButton = {
            TextButton(shape = MaterialTheme.shapes.small, onClick = onConfirm, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(R.string.editor_delete), color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = { TextButton(shape = MaterialTheme.shapes.small, onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
private fun SaveBar(state: EditorState, actions: EditorActions) {
    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface)) {
        HorizontalDivider(color = LocalPalette.current.border)
        Column(Modifier.padding(ScreenMargin), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (FormError.CouldNotSave in state.errors) {
                Text(stringResource(R.string.editor_error_save), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
            }
            PrimaryButton(stringResource(R.string.editor_save), actions.save, Modifier.fillMaxWidth(), enabled = !state.saving)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun EditorBody(state: EditorState, newCategory: NewCategory?, actions: EditorActions) {
    val form = state.form
    val isTransfer = form.mode == EntryMode.Transfer
    val amountFocus = remember { FocusRequester() }
    var pickingDate by rememberSaveable { mutableStateOf(false) }
    var pickingTime by rememberSaveable { mutableStateOf(false) }
    var picker by rememberSaveable { mutableStateOf<Picker?>(null) }
    var categoryAtOpen by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { if (state.isNew) amountFocus.requestFocus() }
    // Making a category chooses it, which also closes its picker.
    LaunchedEffect(form.categoryId) { if (picker == Picker.Category && form.categoryId != categoryAtOpen) picker = null }
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(top = 4.dp, bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (state.modes.size > 1) {
            SegmentedControl(
                state.modes.map { stringResource(it.label()) },
                state.modes.indexOf(form.mode),
                { actions.update { f -> f.copy(mode = state.modes[it]) } },
                Modifier.padding(horizontal = ScreenMargin),
            )
        }
        val currency = state.accounts.find { it.id == form.accountId }?.currency?.ifEmpty { null } ?: "USD"
        val amountError = amountError(state.errors)
        Column(Modifier.padding(horizontal = ScreenMargin), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(currency, style = MaterialTheme.typography.labelLarge, color = LocalPalette.current.muted)
            AmountField(
                value = form.amount,
                onValueChange = { text -> actions.update { it.copy(amount = text) } },
                digits = currencyDigits(currency),
                centsFirst = LocalCentsFirst.current,
                label = stringResource(R.string.editor_amount),
                isError = amountError != null,
                supportingText = amountError?.let { stringResource(it) },
                hero = true,
                modifier = Modifier.fillMaxWidth().focusRequester(amountFocus),
            )
        }
        GroupedListCard {
            if (isTransfer) {
                row {
                    PickRow(
                        stringResource(R.string.editor_from), state.accounts.labelOf(form.accountId), stringResource(R.string.editor_choose),
                        if (FormError.AccountMissing in state.errors) stringResource(R.string.editor_error_account) else null,
                    ) { picker = Picker.Account }
                }
                row { SwapRow(enabled = form.toAccountId != null) { actions.update { it.swapped() } } }
                row {
                    PickRow(
                        stringResource(R.string.editor_to), state.toAccounts.labelOf(form.toAccountId), stringResource(R.string.editor_choose),
                        when {
                            FormError.ToAccountMissing in state.errors -> stringResource(R.string.editor_error_to)
                            FormError.SameAccount in state.errors -> stringResource(R.string.editor_error_same)
                            state.toAccounts.isEmpty() -> stringResource(R.string.editor_no_to_accounts)
                            else -> null
                        },
                    ) { picker = Picker.To }
                }
            } else {
                row { InputRow(stringResource(R.string.editor_payee), form.payee, singleLine = true) { text -> actions.update { it.copy(payee = text) } } }
                row {
                    PickRow(
                        stringResource(R.string.editor_account), state.accounts.labelOf(form.accountId), stringResource(R.string.editor_choose),
                        if (FormError.AccountMissing in state.errors) stringResource(R.string.editor_error_account) else null,
                    ) { picker = Picker.Account }
                }
                row {
                    PickRow(
                        stringResource(R.string.editor_category), state.categories.labelOf(form.categoryId), stringResource(R.string.editor_choose_category),
                        if (FormError.CategoryMissing in state.errors) stringResource(R.string.editor_error_category) else null,
                    ) { categoryAtOpen = form.categoryId; picker = Picker.Category }
                }
            }
            row {
                WhenRow(
                    form,
                    onDate = { pickingDate = true },
                    onTime = { pickingTime = true },
                    onClearTime = { actions.update { it.copy(time = null) } },
                )
            }
        }
        GroupedListCard {
            if (!isTransfer && state.tags.isNotEmpty()) {
                row { TagsRow(state.tags, form.tagIds, onRemove = { id -> actions.update { it.copy(tagIds = it.tagIds - id) } }, onAdd = { picker = Picker.Tag }) }
            }
            row { InputRow(stringResource(R.string.editor_note), form.note, singleLine = false) { text -> actions.update { it.copy(note = text) } } }
            if (!isTransfer) row { PendingRow(form.pending) { on -> actions.update { it.copy(pending = on) } } }
        }
    }
    picker?.let { which ->
        val close = { picker = null }
        PickerSheet(close) {
            when (which) {
                Picker.Account -> PickerContent(
                    stringResource(if (isTransfer) R.string.editor_from else R.string.editor_account), state.accounts, form.accountId,
                    { id -> actions.update { it.copy(accountId = id) }; close() }, close,
                )
                Picker.To -> PickerContent(
                    stringResource(R.string.editor_to), state.toAccounts, form.toAccountId,
                    { id -> actions.update { it.copy(toAccountId = id) }; close() }, close,
                )
                Picker.Category -> if (newCategory != null) {
                    NewCategorySheetContent(newCategory, actions.setNewCategoryName, actions.createCategory, actions.toggleNewCategory)
                } else {
                    PickerContent(
                        stringResource(R.string.editor_category), state.categories, form.categoryId,
                        { id -> actions.update { it.copy(categoryId = id) }; close() }, close,
                        onNew = actions.toggleNewCategory,
                    )
                }
                Picker.Tag -> PickerContent(
                    stringResource(R.string.editor_tags), state.tags.filter { !it.archived && it.id !in form.tagIds }, null,
                    { id -> actions.update { it.copy(tagIds = it.tagIds + id) }; close() }, close,
                )
            }
        }
    }
    if (pickingDate) DatePickerStep(form.date, onPick = { date -> actions.update { it.copy(date = date) } }, onClose = { pickingDate = false })
    if (pickingTime) TimePickerStep(form.time, onPick = { time -> actions.update { it.copy(time = time) } }, onClose = { pickingTime = false })
}

private fun List<Choice>.labelOf(id: String?) = find { it.id == id }?.label.orEmpty()

private fun EntryMode.label() = when (this) {
    EntryMode.Expense -> R.string.editor_mode_expense
    EntryMode.Income -> R.string.editor_mode_income
    EntryMode.Transfer -> R.string.editor_mode_transfer
}

private fun amountError(errors: Set<FormError>) = when {
    FormError.AmountMissing in errors -> R.string.editor_error_amount_missing
    FormError.AmountInvalid in errors -> R.string.editor_error_amount_invalid
    FormError.AmountTooPrecise in errors -> R.string.editor_error_amount_precise
    FormError.AmountZero in errors -> R.string.editor_error_amount_zero
    FormError.AmountTooLarge in errors -> R.string.editor_error_amount_large
    else -> null
}

/** A row that opens a picker: the label, the chosen value (or a hint), a chevron, and a problem in words under it. */
@Composable
private fun PickRow(label: String, value: String, placeholder: String, error: String?, onClick: () -> Unit) {
    val palette = LocalPalette.current
    Column(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick, role = Role.Button).heightIn(min = RowHeight).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(label, style = MaterialTheme.typography.bodyMedium, color = palette.muted)
            Text(
                value.ifEmpty { placeholder },
                style = MaterialTheme.typography.titleMedium,
                color = if (value.isEmpty()) palette.muted else palette.text,
                textAlign = TextAlign.End,
                modifier = Modifier.weight(1f),
            )
            Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null, tint = palette.muted, modifier = Modifier.size(20.dp))
        }
        if (error != null) Text(error, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error)
    }
}

/** A row with a text box: the label, and what is typed to its right. */
@Composable
private fun InputRow(label: String, value: String, singleLine: Boolean, onChange: (String) -> Unit) {
    val palette = LocalPalette.current
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = RowHeight).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = palette.muted)
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = singleLine,
            textStyle = MaterialTheme.typography.titleMedium.copy(color = palette.text, textAlign = TextAlign.End),
            cursorBrush = SolidColor(palette.accent),
            modifier = Modifier.weight(1f).heightIn(min = TouchTarget).semantics { contentDescription = label },
            decorationBox = { inner -> Box(contentAlignment = Alignment.CenterEnd, modifier = Modifier.heightIn(min = TouchTarget)) { inner() } },
        )
    }
}

/** The swap button between From and To, kept on its own line so the two rows stay whole. */
@Composable
private fun SwapRow(enabled: Boolean, onSwap: () -> Unit) {
    val swap = stringResource(R.string.editor_swap)
    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), horizontalArrangement = Arrangement.End) {
        IconButton(onClick = onSwap, enabled = enabled, modifier = Modifier.size(TouchTarget).semantics { contentDescription = swap }) {
            Icon(painterResource(R.drawable.ic_swap), contentDescription = null, tint = if (enabled) LocalPalette.current.accent else LocalPalette.current.muted)
        }
    }
}

/** When: the date, and a time that is optional (a ✕ clears it; "+ Add time" brings it back). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WhenRow(form: EditorForm, onDate: () -> Unit, onTime: () -> Unit, onClearTime: () -> Unit) {
    val palette = LocalPalette.current
    val is24Hour = DateFormat.is24HourFormat(LocalContext.current)
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = RowHeight).padding(horizontal = 16.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.editor_when), style = MaterialTheme.typography.bodyMedium, color = palette.muted)
        FlowRow(modifier = Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalArrangement = Arrangement.Center) {
            ValuePill(if (form.date.isEmpty()) "" else formatEntryDate(form.date), onDate)
            val time = form.time
            if (time != null) {
                // The time and its cross wrap together, so the cross never sits alone on a line.
                Row(verticalAlignment = Alignment.CenterVertically) {
                    ValuePill(formatTime(time, is24Hour), onTime)
                    val clear = stringResource(R.string.editor_time_clear)
                    IconButton(onClick = onClearTime, modifier = Modifier.size(TouchTarget).semantics { contentDescription = clear }) {
                        Icon(painterResource(R.drawable.ic_close), contentDescription = null, tint = palette.muted, modifier = Modifier.size(16.dp))
                    }
                }
            } else {
                ValuePill(stringResource(R.string.editor_add_time), onTime, dashed = true)
            }
        }
    }
}

/** A tappable value in a pill: 36 dp to look at, 48 dp to touch. */
@Composable
private fun ValuePill(text: String, onClick: () -> Unit, dashed: Boolean = false) {
    val palette = LocalPalette.current
    Box(modifier = Modifier.clickable(onClick = onClick, role = Role.Button).heightIn(min = TouchTarget), contentAlignment = Alignment.Center) {
        Box(
            modifier = Modifier
                .height(36.dp)
                .then(if (dashed) Modifier.border(1.dp, palette.border, RoundedCornerShape(18.dp)) else Modifier.background(palette.border.copy(alpha = 0.5f), RoundedCornerShape(18.dp)))
                .padding(horizontal = 14.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(text, style = MaterialTheme.typography.labelLarge, color = if (dashed) palette.muted else palette.text, maxLines = 1)
        }
    }
}

/** Tags: a chip for each chosen tag (a tap removes it) and "+ Tag" to add another, up to the most one entry can have. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TagsRow(tags: List<Choice>, chosen: List<String>, onRemove: (String) -> Unit, onAdd: () -> Unit) {
    val palette = LocalPalette.current
    val shown = chosen.mapNotNull { id -> tags.find { it.id == id } }
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = RowHeight).padding(horizontal = 16.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.editor_tags), style = MaterialTheme.typography.bodyMedium, color = palette.muted)
        FlowRow(modifier = Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalArrangement = Arrangement.Center) {
            shown.forEach { tag ->
                val name = if (tag.archived) stringResource(R.string.editor_archived, tag.label) else tag.label
                val remove = stringResource(R.string.editor_tag_remove, tag.label)
                Box(modifier = Modifier.clickable(onClick = { onRemove(tag.id) }, role = Role.Button).heightIn(min = TouchTarget).semantics { contentDescription = remove }, contentAlignment = Alignment.Center) {
                    Row(
                        modifier = Modifier.height(36.dp).background(palette.accentSoft, RoundedCornerShape(18.dp)).padding(start = 14.dp, end = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(name, style = MaterialTheme.typography.labelLarge, color = palette.text, maxLines = 1)
                        Icon(painterResource(R.drawable.ic_close), contentDescription = null, tint = palette.muted, modifier = Modifier.size(14.dp))
                    }
                }
            }
            if (chosen.size >= MaxTagsPerEntry) {
                Text(stringResource(R.string.editor_tags_full), style = MaterialTheme.typography.labelMedium, color = palette.muted)
            } else if (tags.any { !it.archived && it.id !in chosen }) {
                ValuePill(stringResource(R.string.editor_tag_add), onAdd, dashed = true)
            }
        }
    }
}

/** The web's Status: off is cleared (the default), on is pending, which stays out of the posted balance. */
@Composable
private fun PendingRow(pending: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().toggleable(value = pending, onValueChange = onChange, role = Role.Switch).heightIn(min = RowHeight).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(stringResource(R.string.editor_pending), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.editor_pending_hint), style = MaterialTheme.typography.labelMedium, color = LocalPalette.current.muted)
        }
        Switch(checked = pending, onCheckedChange = null)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DatePickerStep(date: String, onPick: (String) -> Unit, onClose: () -> Unit) {
    val initial = runCatching { LocalDate.parse(date) }.getOrNull()?.atStartOfDay()?.toInstant(ZoneOffset.UTC)?.toEpochMilli()
    val picker = rememberDatePickerState(initialSelectedDateMillis = initial)
    DatePickerDialog(
        onDismissRequest = onClose,
        confirmButton = {
            TextButton(shape = MaterialTheme.shapes.small, onClick = {
                picker.selectedDateMillis?.let { millis -> onPick(Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate().toString()) }
                onClose()
            }) { Text(stringResource(R.string.editor_date_ok)) }
        },
        dismissButton = { TextButton(shape = MaterialTheme.shapes.small, onClick = onClose) { Text(stringResource(R.string.cancel)) } },
    ) { DatePicker(state = picker) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TimePickerStep(time: String?, onPick: (String) -> Unit, onClose: () -> Unit) {
    val start = time?.let { runCatching { LocalTime.parse(it) }.getOrNull() } ?: LocalTime.now()
    val picker = rememberTimePickerState(start.hour, start.minute, DateFormat.is24HourFormat(LocalContext.current))
    val choose = { chosen: LocalTime ->
        onPick("%02d:%02d".format(chosen.hour, chosen.minute))
        onClose()
    }
    TimePickerDialog(
        onDismissRequest = onClose,
        title = { Text(stringResource(R.string.editor_time_add)) },
        confirmButton = {
            TextButton(shape = MaterialTheme.shapes.small, onClick = { choose(LocalTime.of(picker.hour, picker.minute)) }) { Text(stringResource(R.string.editor_date_ok)) }
        },
        dismissButton = {
            TextButton(shape = MaterialTheme.shapes.small, onClick = { choose(LocalTime.now()) }) { Text(stringResource(R.string.editor_time_now)) }
            TextButton(shape = MaterialTheme.shapes.small, onClick = onClose) { Text(stringResource(R.string.cancel)) }
        },
    ) { TimePicker(state = picker) }
}

/** "15:05" as the phone shows times: "15:05", or "3:05 PM" with the 12-hour setting. */
internal fun formatTime(time: String, is24Hour: Boolean, locale: java.util.Locale = java.util.Locale.getDefault()): String =
    LocalTime.parse(time).format(java.time.format.DateTimeFormatter.ofPattern(if (is24Hour) "HH:mm" else "h:mm a", locale))
