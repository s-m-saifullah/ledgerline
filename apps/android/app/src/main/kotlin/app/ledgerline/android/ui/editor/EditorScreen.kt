package app.ledgerline.android.ui.editor

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
                    TextButton(onClick = onClose, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.cancel)) }
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
        OutlinedButton(onClick = onClose, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(stringResource(R.string.back)) }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun EditorForm(state: EditorState, viewModel: EditorViewModel) {
    val form = state.form
    val amountFocus = remember { FocusRequester() }
    var pickingDate by rememberSaveable { mutableStateOf(false) }
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
        OutlinedTextField(
            value = form.amount,
            onValueChange = { text -> viewModel.update { it.copy(amount = text) } },
            label = { Text(stringResource(R.string.editor_amount)) },
            textStyle = MaterialTheme.typography.headlineMedium.copy(fontFeatureSettings = "tnum"),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            singleLine = true,
            isError = amountError != null,
            supportingText = amountError?.let { { Text(stringResource(it)) } },
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
            ChoiceField(
                label = stringResource(R.string.editor_category),
                choices = state.categories,
                selected = form.categoryId,
                none = stringResource(R.string.editor_no_category),
                onSelect = { id -> viewModel.update { it.copy(categoryId = id) } },
            )
        }
        OutlinedButton(onClick = { pickingDate = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text(stringResource(R.string.editor_date, if (form.date.isEmpty()) "" else formatEntryDate(form.date)))
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
                Text(stringResource(R.string.editor_tags), style = MaterialTheme.typography.titleSmall)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    state.tags.forEach { tag ->
                        val chosen = tag.id in form.tagIds
                        FilterChip(
                            selected = chosen,
                            onClick = { viewModel.update { it.copy(tagIds = if (chosen) it.tagIds - tag.id else it.tagIds + tag.id) } },
                            label = { Text(tag.label) },
                            modifier = Modifier.heightIn(min = 48.dp),
                        )
                    }
                }
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
        Button(onClick = viewModel::save, enabled = !state.saving, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text(stringResource(R.string.editor_save))
        }
        if (state.canDelete) {
            TextButton(onClick = { confirmingDelete = true }, enabled = !state.saving, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
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
                TextButton(onClick = {
                    picker.selectedDateMillis?.let { millis ->
                        val date = Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate().toString()
                        viewModel.update { it.copy(date = date) }
                    }
                    pickingDate = false
                }) { Text(stringResource(R.string.editor_date_ok)) }
            },
            dismissButton = { TextButton(onClick = { pickingDate = false }) { Text(stringResource(R.string.cancel)) } },
        ) { DatePicker(state = picker) }
    }
    if (confirmingDelete) {
        AlertDialog(
            onDismissRequest = { confirmingDelete = false },
            title = { Text(stringResource(if (form.mode == EntryMode.Transfer) R.string.editor_delete_transfer_title else R.string.editor_delete_entry_title)) },
            text = { Text(stringResource(R.string.editor_delete_body)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmingDelete = false
                    viewModel.delete()
                }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.editor_delete), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { confirmingDelete = false }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.cancel)) }
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
    onSelect: (String?) -> Unit,
    none: String? = null,
    error: String? = null,
) {
    var open by remember { mutableStateOf(false) }
    val shown = choices.find { it.id == selected }?.label ?: none.orEmpty()
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
            if (none != null) {
                DropdownMenuItem(text = { Text(none) }, onClick = {
                    onSelect(null)
                    open = false
                })
            }
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
