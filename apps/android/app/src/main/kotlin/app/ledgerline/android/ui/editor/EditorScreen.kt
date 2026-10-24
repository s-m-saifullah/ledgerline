package app.ledgerline.android.ui.editor

import androidx.compose.foundation.BorderStroke
import app.ledgerline.android.ui.theme.LocalPalette
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import app.ledgerline.android.R
import app.ledgerline.android.ui.format.formatEntryDate
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.Alignment
import android.text.format.DateFormat
import androidx.compose.ui.platform.LocalContext
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TimePickerDialog
import androidx.compose.material3.rememberTimePickerState
import java.time.ZoneOffset

/** Add, edit or delete an entry or a transfer. Saving works offline: the change waits in the outbox until sent. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditorScreen(target: EditorTarget, session: String, onClose: () -> Unit, viewModel: EditorViewModel = hiltViewModel(key = "editor")) {
    LaunchedEffect(session) { viewModel.open(target, session) }
    val latest by viewModel.state.collectAsState()
    // Only this opening's state counts: the view model may still hold the last opening's (for example a finished save).
    val state = latest?.takeIf { it.session == session }
    BackHandler(onBack = onClose)
    LaunchedEffect(state?.done) { if (state?.done == true) onClose() }
    val title = when {
        target is EditorTarget.Fix -> R.string.editor_title_fix
        state?.isNew == true -> R.string.editor_title_new
        state?.form?.mode == EntryMode.Transfer -> R.string.editor_title_transfer
        else -> R.string.editor_title_entry
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(title)) },
                navigationIcon = {
                    TextButton(shape = MaterialTheme.shapes.small, onClick = onClose, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.cancel)) }
                },
            )
        },
    ) { padding ->
        val current = state
        Box(modifier = Modifier.fillMaxSize().padding(padding).imePadding()) {
            when {
                current == null -> Unit
                current.readOnly != null -> ReadOnlyNotice(current.readOnly, onClose)
                else -> EditorForm(current, viewModel)
            }
        }
    }
}

@Composable
private fun ReadOnlyNotice(reason: ReadOnly, onClose: () -> Unit) {
    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(
            stringResource(
                when (reason) {
                    ReadOnly.Split -> R.string.editor_readonly_split
                    ReadOnly.Linked -> R.string.editor_readonly_linked
                    ReadOnly.TransferExtras -> R.string.editor_readonly_transfer
                    ReadOnly.Gone -> R.string.editor_readonly_gone
                },
            ),
            style = MaterialTheme.typography.bodyLarge,
        )
        OutlinedButton(shape = MaterialTheme.shapes.small, border = BorderStroke(1.dp, LocalPalette.current.border), onClick = onClose, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(stringResource(R.string.back)) }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun EditorForm(state: EditorState, viewModel: EditorViewModel) {
    val form = state.form
    val amountFocus = remember { FocusRequester() }
    val centsFirst = LocalCentsFirst.current
    var pickingDate by rememberSaveable { mutableStateOf(false) }
    var pickingTime by rememberSaveable { mutableStateOf(false) }
    var confirmingDelete by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) { if (state.isNew) amountFocus.requestFocus() }
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (state.modes.size > 1) {
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                state.modes.forEachIndexed { index, mode ->
                    SegmentedButton(
                        selected = form.mode == mode,
                        onClick = { viewModel.update { it.copy(mode = mode) } },
                        shape = SegmentedButtonDefaults.itemShape(index, state.modes.size),
                        modifier = Modifier.heightIn(min = 48.dp),
                    ) { Text(stringResource(mode.label())) }
                }
            }
        }
        val amountError = amountError(state.errors)
        AmountField(
            value = form.amount,
            onValueChange = { text -> viewModel.update { it.copy(amount = text) } },
            digits = currencyDigits(state.accounts.find { it.id == form.accountId }?.currency?.ifEmpty { null } ?: "USD"),
            centsFirst = centsFirst,
            label = stringResource(R.string.editor_amount),
            isError = amountError != null,
            supportingText = amountError?.let { stringResource(it) },
            modifier = Modifier.fillMaxWidth().focusRequester(amountFocus),
        )
        ChoiceField(
            label = stringResource(if (form.mode == EntryMode.Transfer) R.string.editor_from else R.string.editor_account),
            choices = state.accounts,
            selected = form.accountId,
            error = if (FormError.AccountMissing in state.errors) stringResource(R.string.editor_error_account) else null,
            onSelect = { id -> viewModel.update { it.copy(accountId = id) } },
        )
        if (form.mode == EntryMode.Transfer) {
            ChoiceField(
                label = stringResource(R.string.editor_to),
                choices = state.toAccounts,
                selected = form.toAccountId,
                error = when {
                    FormError.ToAccountMissing in state.errors -> stringResource(R.string.editor_error_to)
                    FormError.SameAccount in state.errors -> stringResource(R.string.editor_error_same)
                    state.toAccounts.isEmpty() -> stringResource(R.string.editor_no_to_accounts)
                    else -> null
                },
                onSelect = { id -> viewModel.update { it.copy(toAccountId = id) } },
            )
        } else {
            ComboField(
                label = stringResource(R.string.editor_category),
                choices = state.categories,
                selected = form.categoryId,
                onSelect = { id -> viewModel.update { it.copy(categoryId = id) } },
                emptyText = stringResource(R.string.editor_no_matching_categories),
                placeholder = stringResource(R.string.editor_choose_category),
                error = if (FormError.CategoryMissing in state.errors) stringResource(R.string.editor_error_category) else null,
            )
            val newCategory by viewModel.newCategory.collectAsState()
            NewCategoryBox(newCategory, viewModel::toggleNewCategory, viewModel::setNewCategoryName, viewModel::createCategory)
        }
        OutlinedButton(shape = MaterialTheme.shapes.small, border = BorderStroke(1.dp, LocalPalette.current.border), onClick = { pickingDate = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text(stringResource(R.string.editor_date, if (form.date.isEmpty()) "" else formatEntryDate(form.date)))
        }
        // Time (optional), as on the web: empty unless the owner adds one.
        val is24Hour = DateFormat.is24HourFormat(LocalContext.current)
        OutlinedButton(
            shape = MaterialTheme.shapes.small,
            border = BorderStroke(1.dp, LocalPalette.current.border),
            onClick = { pickingTime = true },
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) {
            Text(form.time?.let { stringResource(R.string.editor_time, formatTime(it, is24Hour)) } ?: stringResource(R.string.editor_time_add))
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                stringResource(R.string.editor_time_help),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            if (form.time != null) {
                TextButton(shape = MaterialTheme.shapes.small, onClick = { viewModel.update { it.copy(time = null) } }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.editor_time_clear))
                }
            }
        }
        if (form.mode != EntryMode.Transfer) {
            OutlinedTextField(
                value = form.payee,
                onValueChange = { text -> viewModel.update { it.copy(payee = text) } },
                label = { Text(stringResource(R.string.editor_payee)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            if (state.tags.isNotEmpty()) {
                TagPicker(
                    tags = state.tags,
                    chosen = form.tagIds,
                    onAdd = { id -> viewModel.update { it.copy(tagIds = it.tagIds + id) } },
                    onRemove = { id -> viewModel.update { it.copy(tagIds = it.tagIds - id) } },
                )
            }
        }
        OutlinedTextField(
            value = form.note,
            onValueChange = { text -> viewModel.update { it.copy(note = text) } },
            label = { Text(stringResource(R.string.editor_note)) },
            modifier = Modifier.fillMaxWidth(),
        )
        if (FormError.CouldNotSave in state.errors) {
            Text(stringResource(R.string.editor_error_save), color = MaterialTheme.colorScheme.error)
        }
        Button(shape = MaterialTheme.shapes.small, onClick = viewModel::save, enabled = !state.saving, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text(stringResource(R.string.editor_save))
        }
        if (state.canDelete) {
            TextButton(shape = MaterialTheme.shapes.small, onClick = { confirmingDelete = true }, enabled = !state.saving, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text(stringResource(R.string.editor_delete), color = MaterialTheme.colorScheme.error)
            }
        }
    }
    if (pickingDate) {
        val initial = runCatching { LocalDate.parse(form.date) }.getOrNull()?.atStartOfDay()?.toInstant(ZoneOffset.UTC)?.toEpochMilli()
        val picker = rememberDatePickerState(initialSelectedDateMillis = initial)
        DatePickerDialog(
            onDismissRequest = { pickingDate = false },
            confirmButton = {
                TextButton(shape = MaterialTheme.shapes.small, onClick = {
                    picker.selectedDateMillis?.let { millis ->
                        val date = Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate().toString()
                        viewModel.update { it.copy(date = date) }
                    }
                    pickingDate = false
                }) { Text(stringResource(R.string.editor_date_ok)) }
            },
            dismissButton = { TextButton(shape = MaterialTheme.shapes.small, onClick = { pickingDate = false }) { Text(stringResource(R.string.cancel)) } },
        ) { DatePicker(state = picker) }
    }
    if (pickingTime) {
        val start = form.time?.let { runCatching { LocalTime.parse(it) }.getOrNull() } ?: LocalTime.now()
        val picker = rememberTimePickerState(start.hour, start.minute, DateFormat.is24HourFormat(LocalContext.current))
        val choose = { time: LocalTime ->
            viewModel.update { it.copy(time = "%02d:%02d".format(time.hour, time.minute)) }
            pickingTime = false
        }
        TimePickerDialog(
            onDismissRequest = { pickingTime = false },
            title = { Text(stringResource(R.string.editor_time_add)) },
            confirmButton = {
                TextButton(shape = MaterialTheme.shapes.small, onClick = { choose(LocalTime.of(picker.hour, picker.minute)) }) {
                    Text(stringResource(R.string.editor_date_ok))
                }
            },
            dismissButton = {
                TextButton(shape = MaterialTheme.shapes.small, onClick = { choose(LocalTime.now()) }) { Text(stringResource(R.string.editor_time_now)) }
                TextButton(shape = MaterialTheme.shapes.small, onClick = { pickingTime = false }) { Text(stringResource(R.string.cancel)) }
            },
        ) { TimePicker(state = picker) }
    }
    if (confirmingDelete) {
        AlertDialog(
            onDismissRequest = { confirmingDelete = false },
            title = { Text(stringResource(if (form.mode == EntryMode.Transfer) R.string.editor_delete_transfer_title else R.string.editor_delete_entry_title)) },
            text = { Text(stringResource(R.string.editor_delete_body)) },
            confirmButton = {
                TextButton(shape = MaterialTheme.shapes.small, onClick = {
                    confirmingDelete = false
                    viewModel.delete()
                }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.editor_delete), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(shape = MaterialTheme.shapes.small, onClick = { confirmingDelete = false }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.cancel)) }
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChoiceField(
    label: String,
    choices: List<Choice>,
    selected: String?,
    onSelect: (String) -> Unit,
    error: String? = null,
) {
    var open by remember { mutableStateOf(false) }
    val shown = choices.find { it.id == selected }?.label.orEmpty()
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }) {
        OutlinedTextField(
            value = shown,
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            isError = error != null,
            supportingText = error?.let { { Text(it) } },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            choices.forEach { choice ->
                DropdownMenuItem(text = { Text(choice.label) }, onClick = {
                    onSelect(choice.id)
                    open = false
                })
            }
        }
    }
}

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

/** "15:05" as the phone shows times: "15:05", or "3:05 PM" with the 12-hour setting. */
internal fun formatTime(time: String, is24Hour: Boolean, locale: java.util.Locale = java.util.Locale.getDefault()): String =
    LocalTime.parse(time).format(java.time.format.DateTimeFormatter.ofPattern(if (is24Hour) "HH:mm" else "h:mm a", locale))
