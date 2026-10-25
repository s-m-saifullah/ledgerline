package app.ledgerline.android.ui.budgets

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.ui.design.FilterChip
import app.ledgerline.android.ui.design.LinkButton
import app.ledgerline.android.ui.design.PrimaryButton
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SecondaryButton
import app.ledgerline.android.ui.editor.AmountField
import app.ledgerline.android.ui.editor.AmountInput
import app.ledgerline.android.ui.editor.LocalCentsFirst
import app.ledgerline.android.ui.editor.currencyDigits
import app.ledgerline.android.ui.format.formatMoney
import app.ledgerline.android.ui.format.monthLabel
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.api.BudgetLine

/** What Budgets can do about limits, so its content stays a function of plain data. */
class LimitActions(
    val open: (BudgetLine) -> Unit,
    val edit: (String) -> Unit,
    val preset: (Long) -> Unit,
    val save: () -> Unit,
    val close: () -> Unit,
    val askRemove: () -> Unit,
    val dismissRemove: () -> Unit,
    val confirmRemove: () -> Unit,
)

/** The Set limit sheet (ADR 0046); a swipe away or Cancel leaves the limit as it was. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun LimitSheet(ui: LimitUi, actions: LimitActions) {
    ModalBottomSheet(
        onDismissRequest = actions.close,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
    ) {
        LimitSheetContent(ui, actions)
    }
}

/**
 * What the sheet holds, apart from the sheet itself, so it can be tested and photographed: the title and what was
 * spent, the amount, four presets, Save, and (for a limit that exists) a red Remove limit that asks first.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun LimitSheetContent(ui: LimitUi, actions: LimitActions, modifier: Modifier = Modifier) {
    val form = ui.form
    val target = form.target
    val spent = money(target.spent, target.currency)
    val problem = when (form.parsed) {
        AmountInput.Missing, is AmountInput.Valid -> null
        AmountInput.Invalid -> R.string.editor_error_amount_invalid
        AmountInput.TooPrecise -> R.string.editor_error_amount_precise
        AmountInput.Zero -> R.string.editor_error_amount_zero
        AmountInput.TooLarge -> R.string.editor_error_amount_large
    }
    Column(
        modifier = modifier.verticalScroll(rememberScrollState()).padding(horizontal = ScreenMargin).padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.heightIn(min = 56.dp)) {
            Text(
                stringResource(if (form.editing) R.string.limit_title_edit else R.string.limit_title_set),
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            LinkButton(stringResource(R.string.cancel), actions.close)
        }
        Text(
            stringResource(R.string.limit_context, target.name, spent.text, monthLabel(target.month)),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        AmountField(
            value = form.text,
            onValueChange = actions.edit,
            digits = currencyDigits(target.currency),
            centsFirst = LocalCentsFirst.current,
            label = stringResource(R.string.limit_amount, target.currency),
            modifier = Modifier.fillMaxWidth(),
            isError = problem != null,
            supportingText = problem?.let { stringResource(it) },
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            limitPresets(target.currency).forEach { preset ->
                FilterChip(formatMoney(preset, target.currency), selected = form.minor == preset, onClick = { actions.preset(preset) })
            }
        }
        ui.error?.let { error ->
            Text(
                when (error) {
                    LimitError.Offline -> stringResource(R.string.limit_error_offline)
                    LimitError.Forbidden -> stringResource(R.string.limit_error_forbidden)
                    LimitError.Failed -> stringResource(R.string.limit_error_failed)
                    is LimitError.Rejected -> error.detail ?: stringResource(R.string.limit_error_rejected)
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
            )
        }
        PrimaryButton(stringResource(R.string.limit_save), actions.save, Modifier.fillMaxWidth(), enabled = form.canSave && !ui.saving)
        if (form.editing) {
            SecondaryButton(stringResource(R.string.limit_remove), actions.askRemove, Modifier.fillMaxWidth(), enabled = !ui.saving, danger = true)
        }
    }
    if (ui.askRemove) {
        AlertDialog(
            onDismissRequest = actions.dismissRemove,
            title = { Text(stringResource(R.string.limit_remove_title)) },
            text = { Text(stringResource(R.string.limit_remove_body, target.name, monthLabel(target.month))) },
            confirmButton = {
                TextButton(shape = MaterialTheme.shapes.small, onClick = actions.confirmRemove, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.limit_remove_confirm), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(shape = MaterialTheme.shapes.small, onClick = actions.dismissRemove, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.cancel))
                }
            },
        )
    }
}
