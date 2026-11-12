package app.ledgerline.android.ui.clients

import android.text.format.DateFormat
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.ui.design.GroupedListCard
import app.ledgerline.android.ui.design.InputRow
import app.ledgerline.android.ui.design.PickRow
import app.ledgerline.android.ui.design.PickerContent
import app.ledgerline.android.ui.design.PickerSheet
import app.ledgerline.android.ui.design.PrimaryButton
import app.ledgerline.android.ui.design.RowHeight
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SecondaryButton
import app.ledgerline.android.ui.design.SheetTitle
import app.ledgerline.android.ui.design.TouchTarget
import app.ledgerline.android.ui.design.WriteCopy
import app.ledgerline.android.ui.design.Choice
import app.ledgerline.android.ui.design.text
import app.ledgerline.android.ui.editor.AmountField
import app.ledgerline.android.ui.editor.DatePickerStep
import app.ledgerline.android.ui.editor.LocalCentsFirst
import app.ledgerline.android.ui.editor.TimePickerStep
import app.ledgerline.android.ui.editor.ValuePill
import app.ledgerline.android.ui.editor.WhenRow
import app.ledgerline.android.ui.editor.currencyDigits
import app.ledgerline.android.ui.format.formatEntryDate
import app.ledgerline.android.ui.privacy.LocalPrivacy
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.android.ui.theme.LocalPalette

/** What the Log service sheet can do, so its content stays a function of plain data. */
class LogServiceActions(
    val edit: ((ServiceForm) -> ServiceForm) -> Unit,
    val save: () -> Unit,
    val close: () -> Unit,
)

private val ServiceCopy = WriteCopy(
    offline = R.string.service_error_offline,
    forbidden = R.string.service_error_forbidden,
    failed = R.string.service_error_failed,
    rejected = R.string.service_error_rejected,
)

private val AmountProblems = setOf(
    ServiceProblem.AmountMissing, ServiceProblem.AmountInvalid, ServiceProblem.AmountTooPrecise, ServiceProblem.AmountZero, ServiceProblem.AmountTooLarge,
    ServiceProblem.AmountBelowReceived,
)

/** The Log service sheet (ADR 0050, slice 5); a swipe away or Cancel saves nothing. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun LogServiceSheet(ui: LogServiceUi, actions: LogServiceActions) {
    ModalBottomSheet(
        onDismissRequest = actions.close,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
    ) {
        LogServiceSheetContent(ui, actions)
    }
}

/**
 * What the sheet holds, apart from the sheet itself, so it can be tested and photographed (the prototype's `OV.service`):
 * the client, the description, a card with when, the due date and (only when the ledger has more than one) the currency,
 * the amount, the hourly helper folded away, and Save service. Nothing is asked before it sends: no money moves.
 */
@Composable
internal fun LogServiceSheetContent(ui: LogServiceUi, actions: LogServiceActions, modifier: Modifier = Modifier, startOpen: Boolean = false) {
    val form = ui.form
    val amountsHidden = LocalPrivacy.current
    var picking by remember { mutableStateOf(false) }
    var foldOpen by remember { mutableStateOf(startOpen) }
    var pickingDate by remember { mutableStateOf(false) }
    var pickingTime by remember { mutableStateOf(false) }
    var pickingDue by remember { mutableStateOf(false) }
    val inset = Modifier.padding(horizontal = ScreenMargin)
    val problems = form.problems()
    // A wrong amount is said as it is typed; a missing one only once Save was pressed.
    val amountProblem = problems.firstOrNull { it in AmountProblems }?.takeIf { it != ServiceProblem.AmountMissing || it in ui.errors }
    Column(
        // The grouped cards bring their own side margin; everything else is inset to match, so the edges line up.
        modifier = modifier.verticalScroll(rememberScrollState()).padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(inset) { SheetTitle(stringResource(if (form.editing != null) R.string.service_edit_title else R.string.service_title), actions.close) }
        Hint(stringResource(R.string.payment_client, form.client.name))
        GroupedListCard {
            row {
                InputRow(
                    stringResource(R.string.service_description),
                    form.description,
                    onChange = { text -> actions.edit { it.copy(description = text.take(ServiceDescriptionMax)) } },
                    singleLine = false,
                    stacked = true,
                    placeholder = stringResource(R.string.service_description_hint),
                    error = if (ServiceProblem.DescriptionMissing in ui.errors) stringResource(R.string.service_error_description) else null,
                )
            }
        }
        GroupedListCard {
            row {
                WhenRow(
                    form.serviceDate,
                    form.serviceTime,
                    onDate = { pickingDate = true },
                    onTime = { pickingTime = true },
                    onClearTime = { actions.edit { it.copy(serviceTime = null) } },
                )
            }
            row { DueRow(form.dueDate, onPick = { pickingDue = true }, onClear = { actions.edit { it.copy(dueDate = null) } }) }
            if (ui.currencies.size > 1) {
                // Once money was received the server keeps the currency payments were recorded in, so the row is only a label.
                if (form.currencyLocked) row { LockedRow(stringResource(R.string.service_currency), form.currency) }
                else row { PickRow(stringResource(R.string.service_currency), form.currency, stringResource(R.string.editor_choose), null) { picking = true } }
            }
        }
        if (ui.currencies.size > 1 && form.currencyLocked) Hint(stringResource(R.string.service_currency_locked, form.currency))
        AmountField(
            value = form.amount,
            onValueChange = { text -> actions.edit { it.copy(amount = text) } },
            digits = currencyDigits(form.currency),
            centsFirst = LocalCentsFirst.current,
            label = stringResource(R.string.service_amount, form.currency),
            modifier = Modifier.fillMaxWidth().then(inset),
            isError = amountProblem != null,
            supportingText = amountProblem?.let { problem ->
                if (problem == ServiceProblem.AmountBelowReceived) {
                    stringResource(R.string.service_error_below_received, money(form.editing?.received ?: 0, form.currency).text)
                } else {
                    stringResource(problem.messageRes())
                }
            },
        )
        GroupedListCard {
            row { FoldRow(stringResource(R.string.service_fold), foldOpen) { foldOpen = !foldOpen } }
            if (foldOpen) {
                row {
                    InputRow(
                        stringResource(R.string.service_hours),
                        form.hours,
                        onChange = { text -> actions.edit { it.copy(hours = text.take(HoursMax)) } },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    )
                }
                row {
                    AmountField(
                        value = form.hourlyRate,
                        onValueChange = { text -> actions.edit { it.copy(hourlyRate = text) } },
                        digits = currencyDigits(form.currency),
                        centsFirst = LocalCentsFirst.current,
                        label = stringResource(R.string.service_hourly_rate, form.currency),
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }
                when (val result = form.hourly) {
                    null -> Unit
                    is HourlyResult.Wrong -> row {
                        Text(
                            stringResource(result.problem.messageRes()),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                        )
                    }
                    is HourlyResult.Total -> {
                        row {
                            Text(
                                stringResource(
                                    R.string.service_hourly_result,
                                    result.hours,
                                    money(result.rate, form.currency).text,
                                    money(result.total, form.currency).text,
                                ),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                            )
                        }
                        row {
                            SecondaryButton(
                                stringResource(R.string.service_hourly_use),
                                { actions.edit { it.useTotal(describe = !amountsHidden) } },
                                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                            )
                        }
                    }
                }
            }
        }
        ui.error?.let { error ->
            Text(error.text(ServiceCopy), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error, modifier = inset)
        }
        PrimaryButton(stringResource(R.string.service_save), actions.save, Modifier.fillMaxWidth().then(inset), enabled = !ui.saving)
    }
    if (picking) {
        val close = { picking = false }
        PickerSheet(close) {
            PickerContent(
                stringResource(R.string.service_currency), ui.currencies.map { Choice(it, it) }, form.currency,
                { code -> actions.edit { it.copy(currency = code) }; close() }, close,
            )
        }
    }
    if (pickingDate) DatePickerStep(form.serviceDate, onPick = { date -> actions.edit { it.copy(serviceDate = date) } }, onClose = { pickingDate = false })
    if (pickingTime) TimePickerStep(form.serviceTime, onPick = { time -> actions.edit { it.copy(serviceTime = time) } }, onClose = { pickingTime = false })
    if (pickingDue) DatePickerStep(form.dueDate ?: form.serviceDate, onPick = { date -> actions.edit { it.copy(dueDate = date) } }, onClose = { pickingDue = false })
}

/** A row that shows a value and does nothing when pressed, for what cannot be changed. */
@Composable
private fun LockedRow(label: String, value: String) {
    val palette = LocalPalette.current
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = RowHeight).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = palette.muted)
        Text(value, style = MaterialTheme.typography.titleMedium, color = palette.muted, textAlign = androidx.compose.ui.text.style.TextAlign.End, modifier = Modifier.weight(1f))
    }
}

/** The longest hours text worth typing: "9999.99". */
private const val HoursMax = 7

/**
 * Due date: optional, as the time is (a ✕ inside the pill clears it; "+ Add due date" brings it back). Laid out as the When row
 * above it, so the two pills end at the same edge.
 */
@Composable
private fun DueRow(due: String?, onPick: () -> Unit, onClear: () -> Unit) {
    val palette = LocalPalette.current
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = RowHeight).padding(horizontal = 16.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.service_due), style = MaterialTheme.typography.bodyMedium, color = palette.muted)
        Row(modifier = Modifier.weight(1f), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
            if (due != null) {
                ValuePill(formatEntryDate(due), onPick, onClear = onClear, clearLabel = stringResource(R.string.service_due_clear))
            } else {
                ValuePill(stringResource(R.string.service_due_add), onPick, dashed = true)
            }
        }
    }
}

private fun ServiceProblem.messageRes() = when (this) {
    ServiceProblem.DescriptionMissing -> R.string.service_error_description
    ServiceProblem.AmountMissing -> R.string.editor_error_amount_missing
    ServiceProblem.AmountInvalid -> R.string.editor_error_amount_invalid
    ServiceProblem.AmountTooPrecise -> R.string.editor_error_amount_precise
    ServiceProblem.AmountZero -> R.string.editor_error_amount_zero
    ServiceProblem.AmountTooLarge -> R.string.editor_error_amount_large
    // Said with the amount received, where the sentence is shown.
    ServiceProblem.AmountBelowReceived -> error("Said with the amount received")
}

private fun HourlyProblem.messageRes() = when (this) {
    HourlyProblem.Hours -> R.string.service_hourly_hours_invalid
    HourlyProblem.Rate -> R.string.service_hourly_rate_invalid
    HourlyProblem.Range -> R.string.service_hourly_range
}
