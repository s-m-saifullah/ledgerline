package app.ledgerline.android.ui.budgets

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.ui.design.FilterChip
import app.ledgerline.android.ui.design.GroupedListCard
import app.ledgerline.android.ui.design.LedgerSheet
import app.ledgerline.android.ui.design.PrimaryButton
import app.ledgerline.android.ui.design.Question
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SecondaryButton
import app.ledgerline.android.ui.design.SheetTitle
import app.ledgerline.android.ui.design.SwitchRow
import app.ledgerline.android.ui.design.WriteCopy
import app.ledgerline.android.ui.design.text
import app.ledgerline.android.ui.editor.AmountField
import app.ledgerline.android.ui.editor.LocalCentsFirst
import app.ledgerline.android.ui.editor.currencyDigits
import app.ledgerline.android.ui.editor.AmountIssue
import app.ledgerline.android.ui.editor.messageRes
import app.ledgerline.android.ui.format.formatMoney
import app.ledgerline.android.ui.format.monthLabel
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.android.ui.privacy.spokenWhenPrivate
import app.ledgerline.api.BudgetLine

/** What Budgets can do about limits, so its content stays a function of plain data. */
class LimitActions(
    val open: (BudgetLine) -> Unit,
    val edit: (String) -> Unit,
    val preset: (Long) -> Unit,
    val carryOver: (Boolean) -> Unit,
    val save: () -> Unit,
    val close: () -> Unit,
    val askRemove: () -> Unit,
    val dismissRemove: () -> Unit,
    val confirmRemove: () -> Unit,
)

private val LimitCopy = WriteCopy(
    forbidden = R.string.limit_error_forbidden,
)

/** The Set limit sheet (ADR 0046); a swipe away or Cancel leaves the limit as it was. */
@Composable
internal fun LimitSheet(ui: LimitUi, actions: LimitActions) {
    LedgerSheet(actions.close) { LimitSheetContent(ui, actions) }
}

/**
 * What the sheet holds, apart from the sheet itself, so it can be tested and photographed: the title and what was
 * spent, the amount, four presets, the carry-over switch, Save, and (for a limit that exists) a red Remove limit that
 * asks first.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun LimitSheetContent(ui: LimitUi, actions: LimitActions, modifier: Modifier = Modifier) {
    val form = ui.form
    val target = form.target
    val inset = Modifier.padding(horizontal = ScreenMargin)
    val spent = money(target.spent, target.currency)
    // A blank box for a new limit is not scolded; one that was emptied says what it needs.
    val problem = form.problem?.takeIf { it != LimitProblem.Missing || form.editing }?.messageRes()
    Column(
        modifier = modifier.verticalScroll(rememberScrollState()).padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(inset) { SheetTitle(stringResource(R.string.limit_title_set), actions.close) }
        Text(
            stringResource(R.string.limit_context, target.name, spent.text, monthLabel(target.month)),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = inset.spokenWhenPrivate(stringResource(R.string.limit_context, target.name, spent.spoken, monthLabel(target.month))),
        )
        AmountField(
            value = form.text,
            onValueChange = actions.edit,
            digits = currencyDigits(target.currency),
            centsFirst = LocalCentsFirst.current,
            label = stringResource(R.string.limit_amount, target.currency),
            modifier = Modifier.fillMaxWidth().then(inset),
            isError = problem != null,
            supportingText = problem?.let { stringResource(it) },
        )
        FlowRow(modifier = inset, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            limitPresets(target.currency).forEach { preset ->
                FilterChip(formatMoney(preset, target.currency), selected = form.minor == preset, onClick = { actions.preset(preset) })
            }
        }
        GroupedListCard { row { SwitchRow(stringResource(R.string.limit_carry_over), null, form.rollover, actions.carryOver) } }
        ui.error?.let { error ->
            Text(
                error.text(LimitCopy),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
                modifier = inset,
            )
        }
        PrimaryButton(stringResource(R.string.limit_save), actions.save, Modifier.fillMaxWidth().then(inset), enabled = form.canSave && !ui.saving)
        if (form.editing) {
            SecondaryButton(stringResource(R.string.limit_remove), actions.askRemove, Modifier.fillMaxWidth().then(inset), enabled = !ui.saving, danger = true)
        }
    }
    if (ui.askRemove) {
        Question(
            title = stringResource(R.string.limit_remove_title),
            confirm = stringResource(R.string.limit_remove_confirm),
            onConfirm = actions.confirmRemove,
            onDismiss = actions.dismissRemove,
            danger = true,
        ) { Text(stringResource(R.string.limit_remove_body, target.name, monthLabel(target.month))) }
    }
}

/** The words for each problem: the web's three sentences, and the shared ones for decimals and size. */
internal fun LimitProblem.messageRes() = when (this) {
    LimitProblem.Missing -> R.string.limit_error_missing
    LimitProblem.Negative -> R.string.limit_error_negative
    LimitProblem.Invalid -> R.string.limit_error_invalid
    LimitProblem.TooPrecise -> AmountIssue.TooPrecise.messageRes()
    LimitProblem.TooLarge -> AmountIssue.TooLarge.messageRes()
}
