package app.ledgerline.android.ui.loans

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.ui.clients.FoldRow
import app.ledgerline.android.ui.clients.Hint
import app.ledgerline.android.ui.design.Choice
import app.ledgerline.android.ui.design.GroupedListCard
import app.ledgerline.android.ui.design.InputRow
import app.ledgerline.android.ui.design.PickRow
import app.ledgerline.android.ui.design.PickerContent
import app.ledgerline.android.ui.design.PickerSheet
import app.ledgerline.android.ui.design.PrimaryButton
import app.ledgerline.android.ui.design.RowHeight
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SheetTitle
import app.ledgerline.android.ui.design.WriteCopy
import app.ledgerline.android.ui.design.text
import app.ledgerline.android.ui.editor.AmountField
import app.ledgerline.android.ui.editor.DatePickerStep
import app.ledgerline.android.ui.editor.LocalCentsFirst
import app.ledgerline.android.ui.editor.ValuePill
import app.ledgerline.android.ui.editor.currencyDigits
import app.ledgerline.android.ui.format.formatEntryDate
import app.ledgerline.android.ui.privacy.LocalPrivacy
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.android.ui.theme.LocalPalette
import kotlin.math.abs

/** What the Lend, Borrow and Repay sheet can do, so its content stays a function of plain data. */
class LoanActions(
    val edit: ((LoanForm) -> LoanForm) -> Unit,
    val save: () -> Unit,
    val dismissAsk: () -> Unit,
    val confirm: () -> Unit,
    val close: () -> Unit,
)

private val LoanCopy = WriteCopy(
    offline = R.string.loan_error_offline,
    forbidden = R.string.loan_error_forbidden,
    failed = R.string.loan_error_failed,
    rejected = R.string.loan_error_rejected,
)

private enum class LoanPicker { Account, Currency }

private val AmountProblems = setOf(
    LoanProblem.AmountMissing, LoanProblem.AmountInvalid, LoanProblem.AmountTooPrecise, LoanProblem.AmountZero, LoanProblem.AmountTooLarge,
    LoanProblem.MoreThanOpen,
)

/** The Lend, Borrow and Repay sheet (ADR 0050, slice 6); a swipe away or Cancel moves no money. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun LoanSheet(ui: LoanUi, actions: LoanActions) {
    ModalBottomSheet(
        onDismissRequest = actions.close,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
    ) {
        LoanSheetContent(ui, actions)
    }
}

/**
 * What the sheet holds, apart from the sheet itself, so it can be tested and photographed (the web's `LoanDialog`, in the
 * prototype's `OV.loan` shape): the title, a short hint or, for a repayment, what is open, the amount, a currency when
 * several loans are open, the account (Paid from or Received into), the date and note folded away, and one button. Save
 * asks a question first, and nothing is sent until it is answered.
 */
@Composable
internal fun LoanSheetContent(ui: LoanUi, actions: LoanActions, modifier: Modifier = Modifier) {
    val form = ui.form
    var picker by remember { mutableStateOf<LoanPicker?>(null) }
    var foldOpen by remember { mutableStateOf(false) }
    var pickingDate by remember { mutableStateOf(false) }
    val inset = Modifier.padding(horizontal = ScreenMargin)
    // A wrong amount is said as it is typed; a missing one only once Save was pressed.
    val amountProblem = form.problems().firstOrNull { it in AmountProblems }?.takeIf { it != LoanProblem.AmountMissing || it in ui.errors }
    Column(
        // The grouped cards bring their own side margin; everything else is inset to match, so the edges line up.
        modifier = modifier.verticalScroll(rememberScrollState()).padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(inset) { SheetTitle(titleOf(form), actions.close) }
        when (form.kind) {
            LoanKind.Lend -> Hint(stringResource(R.string.loan_hint_lend))
            LoanKind.Borrow -> Hint(stringResource(R.string.loan_hint_borrow))
            LoanKind.Repay -> OpenLine(form)
        }
        AmountField(
            value = form.amount,
            onValueChange = { text -> actions.edit { it.copy(amount = text) } },
            digits = currencyDigits(form.amountCurrency),
            centsFirst = LocalCentsFirst.current,
            label = stringResource(R.string.loan_amount, form.amountCurrency),
            modifier = Modifier.fillMaxWidth().then(inset),
            isError = amountProblem != null,
            supportingText = amountProblem?.let { stringResource(it.messageRes()) },
        )
        GroupedListCard {
            if (form.currencyChoices.isNotEmpty()) {
                row { PickRow(stringResource(R.string.loan_currency), form.currency.orEmpty(), "", null) { picker = LoanPicker.Currency } }
            }
            row {
                PickRow(
                    stringResource(if (form.accountReceives) R.string.loan_received_into else R.string.loan_paid_from),
                    form.account?.name.orEmpty(),
                    stringResource(R.string.editor_choose),
                    if (LoanProblem.AccountMissing in ui.errors) stringResource(R.string.loan_error_account) else null,
                ) { picker = LoanPicker.Account }
            }
        }
        GroupedListCard {
            row { FoldRow(stringResource(R.string.loan_fold), foldOpen) { foldOpen = !foldOpen } }
            if (foldOpen) {
                row { DateRow(form.date) { pickingDate = true } }
                row {
                    InputRow(
                        stringResource(R.string.editor_note),
                        form.note,
                        onChange = { text -> actions.edit { it.copy(note = text.take(LoanNoteMax)) } },
                        singleLine = false,
                    )
                }
            }
        }
        ui.error?.let { error ->
            Text(error.text(LoanCopy), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error, modifier = inset)
        }
        PrimaryButton(stringResource(saveOf(form.kind)), actions.save, Modifier.fillMaxWidth().then(inset), enabled = !ui.saving)
    }
    picker?.let { which ->
        val close = { picker = null }
        PickerSheet(close) {
            when (which) {
                LoanPicker.Account -> PickerContent(
                    stringResource(if (form.accountReceives) R.string.loan_received_into else R.string.loan_paid_from),
                    form.usable.map { Choice(it.id, it.name, it.currency) }, form.account?.id,
                    { id -> actions.edit { it.copy(accountId = id) }; close() }, close,
                )
                LoanPicker.Currency -> PickerContent(
                    stringResource(R.string.loan_currency),
                    form.currencyChoices.map { Choice(it, it) }, form.currency,
                    { code -> actions.edit { it.withCurrency(code) }; close() }, close,
                )
            }
        }
    }
    if (pickingDate) DatePickerStep(form.date, onPick = { date -> actions.edit { it.copy(date = date) } }, onClose = { pickingDate = false })
    if (ui.asking) Question(ui, actions)
}

/** For a repayment: what is open with the person, in the loan's currency; in privacy mode the amount is masked and said in words. */
@Composable
private fun OpenLine(form: LoanForm) {
    val currency = form.currency ?: return
    val open = money(abs(form.balance), currency)
    val line = stringResource(if (form.owedToYou) R.string.loan_owes_you_now else R.string.loan_you_owe_now, form.who.name, open.text)
    val spoken = stringResource(if (form.owedToYou) R.string.loan_owes_you_now else R.string.loan_you_owe_now, form.who.name, open.spoken)
    Text(
        line,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = ScreenMargin).then(if (LocalPrivacy.current) Modifier.semantics { contentDescription = spoken } else Modifier),
    )
}

/** The date, in the web's own place under the fold; the sheet asks no time (a loan move has none). */
@Composable
private fun DateRow(date: String, onDate: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = RowHeight).padding(horizontal = 16.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.loan_date), style = MaterialTheme.typography.bodyMedium, color = LocalPalette.current.muted, modifier = Modifier.weight(1f))
        ValuePill(formatEntryDate(date), onDate)
    }
}

/** The question before anything is sent: which way, how much, with whom and through which account. */
@Composable
private fun Question(ui: LoanUi, actions: LoanActions) {
    val form = ui.form
    val request = form.request() ?: return
    val amount = money(request.amount.amount, request.amount.currency).text
    val name = form.who.name
    val account = form.account?.name.orEmpty()
    AlertDialog(
        onDismissRequest = actions.dismissAsk,
        title = { Text(stringResource(askTitleOf(form.kind))) },
        text = {
            Text(
                when (form.kind) {
                    LoanKind.Lend -> stringResource(R.string.loan_ask_body_lend, amount, name, account)
                    LoanKind.Borrow -> stringResource(R.string.loan_ask_body_borrow, amount, name, account)
                    LoanKind.Repay -> stringResource(if (form.owedToYou) R.string.loan_ask_body_repay_in else R.string.loan_ask_body_repay_out, amount, name, account)
                },
            )
        },
        confirmButton = {
            TextButton(shape = MaterialTheme.shapes.small, onClick = actions.confirm, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(askConfirmOf(form.kind)))
            }
        },
        dismissButton = {
            TextButton(shape = MaterialTheme.shapes.small, onClick = actions.dismissAsk, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(R.string.cancel))
            }
        },
    )
}

@Composable
private fun titleOf(form: LoanForm): String = when (form.kind) {
    LoanKind.Lend -> stringResource(R.string.loan_title_lend, form.who.name)
    LoanKind.Borrow -> stringResource(R.string.loan_title_borrow, form.who.name)
    LoanKind.Repay -> stringResource(R.string.loan_title_repay)
}

private fun saveOf(kind: LoanKind) = when (kind) {
    LoanKind.Lend -> R.string.loan_save_lend
    LoanKind.Borrow -> R.string.loan_save_borrow
    LoanKind.Repay -> R.string.loan_save_repay
}

private fun askTitleOf(kind: LoanKind) = when (kind) {
    LoanKind.Lend -> R.string.loan_ask_title_lend
    LoanKind.Borrow -> R.string.loan_ask_title_borrow
    LoanKind.Repay -> R.string.loan_ask_title_repay
}

private fun askConfirmOf(kind: LoanKind) = when (kind) {
    LoanKind.Lend -> R.string.loan_ask_confirm_lend
    LoanKind.Borrow -> R.string.loan_ask_confirm_borrow
    LoanKind.Repay -> R.string.loan_ask_confirm_repay
}

private fun LoanProblem.messageRes() = when (this) {
    LoanProblem.AmountMissing -> R.string.editor_error_amount_missing
    LoanProblem.AmountInvalid -> R.string.editor_error_amount_invalid
    LoanProblem.AmountTooPrecise -> R.string.editor_error_amount_precise
    LoanProblem.AmountZero -> R.string.editor_error_amount_zero
    LoanProblem.AmountTooLarge -> R.string.editor_error_amount_large
    LoanProblem.MoreThanOpen -> R.string.loan_error_more
    LoanProblem.AccountMissing -> R.string.loan_error_account
}
