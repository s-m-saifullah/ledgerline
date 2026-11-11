package app.ledgerline.android.ui.clients

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.ui.design.GroupedListCard
import app.ledgerline.android.ui.design.InputRow
import app.ledgerline.android.ui.design.ListRow
import app.ledgerline.android.ui.design.PickRow
import app.ledgerline.android.ui.design.PickerContent
import app.ledgerline.android.ui.design.PickerSheet
import app.ledgerline.android.ui.design.PrimaryButton
import app.ledgerline.android.ui.design.RowHeight
import app.ledgerline.android.ui.design.ScreenMargin
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
import app.ledgerline.android.ui.theme.LocalPalette

/** What the Record payment sheet can do, so its content stays a function of plain data. */
class PaymentActions(
    val edit: ((PaymentForm) -> PaymentForm) -> Unit,
    val save: () -> Unit,
    val dismissAsk: () -> Unit,
    val confirm: () -> Unit,
    val close: () -> Unit,
)

private val PaymentCopy = WriteCopy(
    offline = R.string.payment_error_offline,
    forbidden = R.string.payment_error_forbidden,
    failed = R.string.payment_error_failed,
    rejected = R.string.payment_error_rejected,
)

private enum class PaymentPicker { Account, Category, TipCategory }

private val AmountProblems = setOf(
    PaymentProblem.AmountMissing, PaymentProblem.AmountInvalid, PaymentProblem.AmountTooPrecise, PaymentProblem.AmountZero, PaymentProblem.AmountTooLarge,
)

/** The Record payment sheet (ADR 0050); a swipe away or Cancel records nothing. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PaymentSheet(ui: PaymentUi, actions: PaymentActions) {
    ModalBottomSheet(
        onDismissRequest = actions.close,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
    ) {
        PaymentSheetContent(ui, actions)
    }
}

/**
 * What the sheet holds, apart from the sheet itself, so it can be tested and photographed (the prototype's
 * `OV["pay-service"]`): the service and what is outstanding, the amount (the full outstanding amount to start with),
 * the tip line when it goes over, the receiving account and the income category, date, time and note folded away, and
 * Save payment. Save asks a question first, and nothing is sent until it is answered.
 */
@Composable
internal fun PaymentSheetContent(ui: PaymentUi, actions: PaymentActions, modifier: Modifier = Modifier) {
    val form = ui.form
    val target = form.target
    var picker by remember { mutableStateOf<PaymentPicker?>(null) }
    var foldOpen by remember { mutableStateOf(false) }
    var pickingDate by remember { mutableStateOf(false) }
    var pickingTime by remember { mutableStateOf(false) }
    val palette = LocalPalette.current
    val inset = Modifier.padding(horizontal = ScreenMargin)
    val problems = form.problems()
    // A wrong amount is said as it is typed; a missing one only once Save was pressed.
    val amountProblem = problems.firstOrNull { it in AmountProblems }?.takeIf { it != PaymentProblem.AmountMissing || it in ui.errors }
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
                val outstanding = money(target.outstanding, target.currency)
                ListRow(
                    title = target.description,
                    subtitle = stringResource(R.string.payment_client, target.clientName),
                    trailing = {
                        Column(horizontalAlignment = Alignment.End) {
                            Text(stringResource(R.string.payment_outstanding), style = MaterialTheme.typography.labelMedium, color = palette.muted)
                            Text(outstanding.text, style = MaterialTheme.typography.titleMedium.tabular(), maxLines = 1, softWrap = false)
                        }
                    },
                    // In privacy mode the amount is masked, so the row says it in one sentence with the spoken amount.
                    described = if (LocalPrivacy.current) {
                        "${target.description}, ${stringResource(R.string.payment_client, target.clientName)}, ${stringResource(R.string.payment_outstanding)} ${outstanding.spoken}"
                    } else {
                        null
                    },
                )
            }
        }
        AmountField(
            value = form.amount,
            onValueChange = { text -> actions.edit { it.copy(amount = text) } },
            digits = currencyDigits(target.currency),
            centsFirst = LocalCentsFirst.current,
            label = stringResource(R.string.payment_amount, target.currency),
            modifier = Modifier.fillMaxWidth().then(inset),
            isError = amountProblem != null,
            supportingText = amountProblem?.let { stringResource(it.messageRes()) },
        )
        if (split != null && tip > 0 && form.cross == null) {
            Text(
                stringResource(R.string.payment_tip_note, money(split.settle, target.currency).text, money(tip, target.currency).text),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = inset,
            )
        }
        GroupedListCard {
            row {
                PickRow(
                    stringResource(R.string.editor_account), ui.accounts.labelOf(form.accountId), stringResource(R.string.editor_choose),
                    if (PaymentProblem.AccountMissing in ui.errors) stringResource(R.string.editor_error_account) else null,
                ) { picker = PaymentPicker.Account }
            }
            row {
                PickRow(
                    stringResource(R.string.payment_category), ui.categories.labelOf(form.categoryId), stringResource(R.string.editor_choose),
                    if (PaymentProblem.CategoryMissing in ui.errors) stringResource(R.string.editor_error_category) else null,
                ) { picker = PaymentPicker.Category }
            }
            if (tip > 0) {
                row {
                    PickRow(
                        stringResource(R.string.payment_tip_category), ui.categories.labelOf(form.tipCategoryId), stringResource(R.string.editor_choose),
                        if (PaymentProblem.TipCategoryMissing in ui.errors) stringResource(R.string.payment_error_tip_category) else null,
                    ) { picker = PaymentPicker.TipCategory }
                }
            }
        }
        form.cross?.let { cross ->
            val issue = cross.receivedIssue?.takeIf { it != AmountIssue.Missing || PaymentProblem.ReceivedMissing in ui.errors }
            ReceivedAmount(cross, form.rate, issue) { text -> actions.edit { it.copy(received = text) } }
            AccountRate(cross, form.date) { text -> actions.edit { it.copy(rateTyped = text) } }
        }
        if (ui.noIncomeCategory) Hint(stringResource(R.string.payment_no_income))
        GroupedListCard {
            row { FoldRow(stringResource(if (form.cross != null) R.string.payment_fold_tip else R.string.payment_fold), foldOpen) { foldOpen = !foldOpen } }
            if (foldOpen) {
                form.cross?.let { cross ->
                    row { TipAmount(cross, invalid = cross.tipIssue != null) { text -> actions.edit { it.copy(tipAmount = text) } } }
                }
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
                        onChange = { text -> actions.edit { it.copy(note = text.take(PaymentNoteMax)) } },
                        singleLine = false,
                    )
                }
            }
        }
        ui.error?.let { error ->
            Text(error.text(PaymentCopy), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error, modifier = inset)
        }
        PrimaryButton(stringResource(R.string.payment_save), actions.save, Modifier.fillMaxWidth().then(inset), enabled = !ui.saving)
    }
    picker?.let { which ->
        val close = { picker = null }
        PickerSheet(close) {
            when (which) {
                PaymentPicker.Account -> PickerContent(
                    stringResource(R.string.editor_account), ui.accounts, form.accountId,
                    { id -> actions.edit { it.withAccount(id, ui.accounts.find { account -> account.id == id }?.currency) }; close() }, close,
                )
                PaymentPicker.Category -> PickerContent(
                    stringResource(R.string.payment_category), ui.categories, form.categoryId,
                    { id -> actions.edit { it.copy(categoryId = id) }; close() }, close,
                )
                PaymentPicker.TipCategory -> PickerContent(
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

/** The question before anything is sent: how much, from whom, into which account, and how much of it is a tip. */
@Composable
private fun Question(ui: PaymentUi, actions: PaymentActions) {
    val form = ui.form
    val target = form.target
    val split = form.split ?: return
    val cross = form.cross
    val total = if (cross != null) money(cross.receivedMinor ?: return, cross.accountCurrency) else money(split.settle + split.tip, target.currency)
    val account = ui.accounts.labelOf(form.accountId)
    AlertDialog(
        onDismissRequest = actions.dismissAsk,
        title = { Text(stringResource(R.string.payment_ask_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (cross != null) {
                    Text(stringResource(R.string.payment_ask_body_across, total.text, target.clientName, account, money(split.settle, target.currency).text))
                    if (form.tipMinor > 0) Text(stringResource(R.string.payment_ask_tip_extra, money(form.tipMinor, form.tipCurrency).text))
                } else {
                    Text(stringResource(R.string.payment_ask_body, total.text, target.clientName, account))
                    if (split.tip > 0) Text(stringResource(R.string.payment_ask_tip, money(split.tip, target.currency).text))
                }
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

/** A row that opens and shuts what is under it, as the prototype's `<details>` rows. */
@Composable
internal fun FoldRow(title: String, open: Boolean, onToggle: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onToggle, role = Role.Button).heightIn(min = RowHeight).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
        Icon(
            painterResource(if (open) R.drawable.ic_chevron_up else R.drawable.ic_chevron_down),
            contentDescription = null,
            tint = LocalPalette.current.muted,
            modifier = Modifier.size(20.dp),
        )
    }
}

@Composable
internal fun Hint(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = ScreenMargin))
}

internal fun List<app.ledgerline.android.ui.design.Choice>.labelOf(id: String?) = find { it.id == id }?.label.orEmpty()

private fun PaymentProblem.messageRes() = when (this) {
    PaymentProblem.AmountMissing -> R.string.editor_error_amount_missing
    PaymentProblem.AmountInvalid -> R.string.editor_error_amount_invalid
    PaymentProblem.AmountTooPrecise -> R.string.editor_error_amount_precise
    PaymentProblem.AmountZero -> R.string.editor_error_amount_zero
    PaymentProblem.AmountTooLarge -> R.string.editor_error_amount_large
    PaymentProblem.ReceivedMissing -> R.string.editor_error_amount_missing
    PaymentProblem.ReceivedInvalid -> R.string.editor_error_amount_invalid
    PaymentProblem.ReceivedTooPrecise -> R.string.editor_error_amount_precise
    PaymentProblem.ReceivedZero -> R.string.editor_error_amount_zero
    PaymentProblem.ReceivedTooLarge -> R.string.editor_error_amount_large
    PaymentProblem.TipInvalid -> R.string.payment_error_tip_invalid
    // The rate line under the amount received says these itself, always, not only after Save.
    PaymentProblem.RateInvalid, PaymentProblem.RateMissing -> error("Said by the rate line")
    PaymentProblem.AccountMissing -> R.string.editor_error_account
    PaymentProblem.CategoryMissing -> R.string.editor_error_category
    PaymentProblem.TipCategoryMissing -> R.string.payment_error_tip_category
}
