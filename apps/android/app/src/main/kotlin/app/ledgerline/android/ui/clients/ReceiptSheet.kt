package app.ledgerline.android.ui.clients

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.online.Online
import app.ledgerline.android.ui.design.Choice
import app.ledgerline.android.ui.design.GroupedListCard
import app.ledgerline.android.ui.design.InputRow
import app.ledgerline.android.ui.design.ListRow
import app.ledgerline.android.ui.design.PickRow
import app.ledgerline.android.ui.design.PickerContent
import app.ledgerline.android.ui.design.PickerSheet
import app.ledgerline.android.ui.design.PrimaryButton
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SecondaryButton
import app.ledgerline.android.ui.design.SectionLabel
import app.ledgerline.android.ui.design.SheetTitle
import app.ledgerline.android.ui.design.WriteCopy
import app.ledgerline.android.ui.design.tabular
import app.ledgerline.android.ui.design.text
import app.ledgerline.android.ui.editor.AmountField
import app.ledgerline.android.ui.editor.DatePickerStep
import app.ledgerline.android.ui.editor.LocalCentsFirst
import app.ledgerline.android.ui.editor.TimePickerStep
import app.ledgerline.android.ui.editor.WhenRow
import app.ledgerline.android.ui.editor.currencyDigits
import app.ledgerline.android.ui.privacy.LocalPrivacy
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.api.ReceiptPreview

/** What the Record payment sheet for a client can do, so its content stays a function of plain data. */
class ReceiptActions(
    val edit: ((ReceiptForm) -> ReceiptForm) -> Unit,
    val payInFull: () -> Unit,
    val chooseCurrency: (String) -> Unit,
    val save: () -> Unit,
    val dismissAsk: () -> Unit,
    val confirm: () -> Unit,
    val close: () -> Unit,
)

private val ReceiptCopy = WriteCopy(
    offline = R.string.payment_error_offline,
    forbidden = R.string.payment_error_forbidden,
    failed = R.string.payment_error_failed,
    rejected = R.string.payment_error_rejected,
)

private enum class ReceiptPicker { Currency, Account, Category, TipCategory }

private val AmountProblems = setOf(
    ReceiptProblem.AmountMissing, ReceiptProblem.AmountInvalid, ReceiptProblem.AmountTooPrecise, ReceiptProblem.AmountZero, ReceiptProblem.AmountTooLarge,
)

/** The Record payment sheet for a client (ADR 0050, slice 4c); a swipe away or Cancel records nothing. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ReceiptSheet(ui: ReceiptUi, actions: ReceiptActions) {
    ModalBottomSheet(
        onDismissRequest = actions.close,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
    ) {
        ReceiptSheetContent(ui, actions)
    }
}

/**
 * What the sheet holds, apart from the sheet itself, so it can be tested and photographed (the prototype's `OV.receive`):
 * the client and what they owe, the amount with Pay full balance, which services the amount pays oldest first, the
 * currency (only when they owe in several), the receiving account and the income category, date, time and note folded
 * away, and Save payment. Save asks a question first, and nothing is sent until it is answered.
 */
@Composable
internal fun ReceiptSheetContent(ui: ReceiptUi, actions: ReceiptActions, modifier: Modifier = Modifier) {
    val form = ui.form
    val target = form.target
    var picker by remember { mutableStateOf<ReceiptPicker?>(null) }
    var foldOpen by remember { mutableStateOf(false) }
    var pickingDate by remember { mutableStateOf(false) }
    var pickingTime by remember { mutableStateOf(false) }
    val inset = Modifier.padding(horizontal = ScreenMargin)
    val problems = form.problems()
    // A wrong amount is said as it is typed; a missing one only once Save was pressed.
    val amountProblem = problems.firstOrNull { it in AmountProblems }?.takeIf { it != ReceiptProblem.AmountMissing || it in ui.errors }
    val split = form.split
    val tip = form.tipMinor
    Column(
        // The grouped cards bring their own side margin; everything else is inset to match, so the edges line up.
        modifier = modifier.verticalScroll(rememberScrollState()).padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(inset) { SheetTitle(stringResource(R.string.payment_title), actions.close) }
        GroupedListCard {
            row {
                val open = money(form.outstanding, form.currency)
                val hint = stringResource(R.string.receipt_open_balance, open.text)
                ListRow(
                    title = target.clientName,
                    subtitle = hint,
                    described = if (LocalPrivacy.current) "${target.clientName}, ${stringResource(R.string.receipt_open_balance, open.spoken)}" else null,
                )
            }
        }
        AmountField(
            value = form.amount,
            onValueChange = { text -> actions.edit { it.copy(amount = text) } },
            digits = currencyDigits(form.currency),
            centsFirst = LocalCentsFirst.current,
            label = stringResource(R.string.payment_amount, form.currency),
            modifier = Modifier.fillMaxWidth().then(inset),
            isError = amountProblem != null,
            supportingText = amountProblem?.let { stringResource(it.messageRes()) },
        )
        SecondaryButton(stringResource(R.string.receipt_pay_full), actions.payInFull, inset, enabled = form.outstanding > 0 && !ui.saving)
        if (split != null && tip > 0) {
            Text(
                stringResource(R.string.payment_tip_note, money(split.settle, form.currency).text, money(tip, form.currency).text),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = inset,
            )
        }
        PreviewSection(ui, form.currency)
        GroupedListCard {
            if (ui.currencies.size > 1) {
                row { PickRow(stringResource(R.string.receipt_currency), form.currency, stringResource(R.string.editor_choose), null) { picker = ReceiptPicker.Currency } }
            }
            row {
                PickRow(
                    stringResource(R.string.editor_account), ui.accounts.labelOf(form.accountId), stringResource(R.string.editor_choose),
                    if (ReceiptProblem.AccountMissing in ui.errors) stringResource(R.string.editor_error_account) else null,
                ) { picker = ReceiptPicker.Account }
            }
            row {
                PickRow(
                    stringResource(R.string.payment_category), ui.categories.labelOf(form.categoryId), stringResource(R.string.editor_choose),
                    if (ReceiptProblem.CategoryMissing in ui.errors) stringResource(R.string.editor_error_category) else null,
                ) { picker = ReceiptPicker.Category }
            }
            if (tip > 0) {
                row {
                    PickRow(
                        stringResource(R.string.payment_tip_category), ui.categories.labelOf(form.tipCategoryId), stringResource(R.string.editor_choose),
                        if (ReceiptProblem.TipCategoryMissing in ui.errors) stringResource(R.string.payment_error_tip_category) else null,
                    ) { picker = ReceiptPicker.TipCategory }
                }
            }
        }
        if (ui.otherCurrencyAccounts) Hint(stringResource(R.string.payment_other_currencies))
        if (ui.noIncomeCategory) Hint(stringResource(R.string.payment_no_income))
        GroupedListCard {
            row { FoldRow(stringResource(R.string.payment_fold), foldOpen) { foldOpen = !foldOpen } }
            if (foldOpen) {
                row {
                    WhenRow(
                        form.date,
                        form.time,
                        onDate = { pickingDate = true },
                        onTime = { pickingTime = true },
                        onClearTime = { actions.edit { it.copy(time = null) } },
                    )
                }
                row {
                    InputRow(
                        stringResource(R.string.editor_note),
                        form.note,
                        onChange = { text -> actions.edit { it.copy(note = text.take(ReceiptNoteMax)) } },
                        singleLine = false,
                    )
                }
            }
        }
        ui.error?.let { error ->
            Text(error.text(ReceiptCopy), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error, modifier = inset)
        }
        PrimaryButton(stringResource(R.string.payment_save), actions.save, Modifier.fillMaxWidth().then(inset), enabled = !ui.saving)
    }
    picker?.let { which ->
        val close = { picker = null }
        PickerSheet(close) {
            when (which) {
                ReceiptPicker.Currency -> PickerContent(
                    stringResource(R.string.receipt_currency), ui.currencies.map { Choice(it, it) }, form.currency,
                    { currency -> actions.chooseCurrency(currency); close() }, close,
                )
                ReceiptPicker.Account -> PickerContent(
                    stringResource(R.string.editor_account), ui.accounts, form.accountId,
                    { id -> actions.edit { it.copy(accountId = id) }; close() }, close,
                )
                ReceiptPicker.Category -> PickerContent(
                    stringResource(R.string.payment_category), ui.categories, form.categoryId,
                    { id -> actions.edit { it.copy(categoryId = id) }; close() }, close,
                )
                ReceiptPicker.TipCategory -> PickerContent(
                    stringResource(R.string.payment_tip_category), ui.categories, form.tipCategoryId,
                    { id -> actions.edit { it.copy(tipCategoryId = id) }; close() }, close,
                )
            }
        }
    }
    if (pickingDate) DatePickerStep(form.date, onPick = { date -> actions.edit { it.copy(date = date) } }, onClose = { pickingDate = false })
    if (pickingTime) TimePickerStep(form.time, onPick = { time -> actions.edit { it.copy(time = time) } }, onClose = { pickingTime = false })
    if (ui.asking) Question(ui, actions)
}

/**
 * Which services the amount pays, oldest first (the prototype's "Pays, oldest first"): one row a service with "Paid in
 * full" or what is left, and one line for the whole. Nothing shows until there is an amount to ask about.
 */
@Composable
private fun PreviewSection(ui: ReceiptUi, currency: String) {
    val inset = Modifier.padding(horizontal = ScreenMargin)
    val notReady = ReceiptProblem.PreviewNotReady in ui.errors
    when (val read = ui.preview) {
        null -> Unit
        Online.Loading -> Hint(stringResource(R.string.receipt_checking))
        Online.Offline, Online.Failed -> Text(stringResource(R.string.receipt_preview_failed), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error, modifier = inset)
        is Online.Ready -> PreviewRows(read.value, currency)
    }
    if (notReady && ui.preview is Online.Loading) Text(stringResource(R.string.receipt_wait), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error, modifier = inset)
}

@Composable
private fun PreviewRows(preview: ReceiptPreview, currency: String) {
    val inset = Modifier.padding(horizontal = ScreenMargin)
    when {
        preview.exceedsBalance -> Text(
            stringResource(R.string.receipt_over, money(preview.openTotal.amount, currency).text),
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error, modifier = inset,
        )
        preview.tooManyServices -> Text(stringResource(R.string.receipt_too_many), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error, modifier = inset)
        else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionLabel(stringResource(R.string.receipt_pays_label))
            GroupedListCard {
                preview.allocations.forEach { a ->
                    row {
                        val applied = money(a.applied.amount, currency)
                        val hint = if (a.remainingAfter.amount == 0L) stringResource(R.string.receipt_paid_full) else stringResource(R.string.receipt_left, money(a.remainingAfter.amount, currency).text)
                        ListRow(
                            title = a.description,
                            subtitle = hint,
                            trailing = { Text(applied.text, style = MaterialTheme.typography.titleMedium.tabular(), maxLines = 1, softWrap = false) },
                            described = if (LocalPrivacy.current) "${a.description}, $hint, ${applied.spoken}" else null,
                        )
                    }
                }
            }
            val summary = paysSummary(preview.allocations)
            val line = when {
                summary.full == 0 -> stringResource(R.string.receipt_pays_part)
                summary.partial -> pluralStringResource(R.plurals.receipt_pays_full_part, summary.full, summary.full)
                else -> pluralStringResource(R.plurals.receipt_pays_full, summary.full, summary.full)
            }
            Text(line, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = inset)
        }
    }
}

/** The question before anything is sent: how much, from whom, into which account, which services it pays and how much is a tip. */
@Composable
private fun Question(ui: ReceiptUi, actions: ReceiptActions) {
    val form = ui.form
    val split = form.split ?: return
    val total = money(split.settle + split.tip, form.currency)
    val account = ui.accounts.labelOf(form.accountId)
    val allocations = (ui.preview as? Online.Ready)?.value?.allocations.orEmpty()
    val summary = paysSummary(allocations)
    val pays = when {
        allocations.isEmpty() -> null
        summary.full == 0 -> stringResource(R.string.receipt_pays_part)
        summary.partial -> pluralStringResource(R.plurals.receipt_pays_full_part, summary.full, summary.full)
        else -> pluralStringResource(R.plurals.receipt_pays_full, summary.full, summary.full)
    }
    AlertDialog(
        onDismissRequest = actions.dismissAsk,
        title = { Text(stringResource(R.string.payment_ask_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.payment_ask_body, total.text, form.target.clientName, account))
                if (pays != null) Text(pays)
                if (split.tip > 0) Text(stringResource(R.string.payment_ask_tip, money(split.tip, form.currency).text))
            }
        },
        confirmButton = {
            TextButton(shape = MaterialTheme.shapes.small, onClick = actions.confirm, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(R.string.payment_ask_confirm))
            }
        },
        dismissButton = {
            TextButton(shape = MaterialTheme.shapes.small, onClick = actions.dismissAsk, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(R.string.cancel))
            }
        },
    )
}

private fun ReceiptProblem.messageRes() = when (this) {
    ReceiptProblem.AmountMissing -> R.string.editor_error_amount_missing
    ReceiptProblem.AmountInvalid -> R.string.editor_error_amount_invalid
    ReceiptProblem.AmountTooPrecise -> R.string.editor_error_amount_precise
    ReceiptProblem.AmountZero -> R.string.editor_error_amount_zero
    ReceiptProblem.AmountTooLarge -> R.string.editor_error_amount_large
    ReceiptProblem.NothingOwed -> R.string.receipt_nothing_owed
    ReceiptProblem.AccountMissing -> R.string.editor_error_account
    ReceiptProblem.CategoryMissing -> R.string.editor_error_category
    ReceiptProblem.TipCategoryMissing -> R.string.payment_error_tip_category
    ReceiptProblem.PreviewNotReady -> R.string.receipt_wait
}
