package app.ledgerline.android.ui.clients

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.editor.AmountField
import app.ledgerline.android.ui.editor.LocalCentsFirst
import app.ledgerline.android.ui.editor.currencyDigits

/*
 * The fields an account in another currency adds to a payment sheet (ADR 0050, slice 4b-1), shared by the sheet for one
 * service and the sheet for a client: what arrived, the rate the two amounts fix, and an optional tip in the account's
 * currency. They are only drawn when the account's currency differs from the service's.
 */

internal fun AmountIssue.messageRes() = when (this) {
    AmountIssue.Missing -> R.string.editor_error_amount_missing
    AmountIssue.Invalid -> R.string.editor_error_amount_invalid
    AmountIssue.TooPrecise -> R.string.editor_error_amount_precise
    AmountIssue.Zero -> R.string.editor_error_amount_zero
    AmountIssue.TooLarge -> R.string.editor_error_amount_large
}

/** What arrived in the account (its own currency's decimals), with the rate sentence under it once both amounts are valid. */
@Composable
internal fun ReceivedAmount(cross: CrossCurrency, rate: CrossRate?, shownIssue: AmountIssue?, onChange: (String) -> Unit) {
    val inset = Modifier.padding(horizontal = ScreenMargin)
    AmountField(
        value = cross.received,
        onValueChange = onChange,
        digits = currencyDigits(cross.accountCurrency),
        centsFirst = LocalCentsFirst.current,
        label = stringResource(R.string.payment_received, cross.accountCurrency),
        modifier = Modifier.fillMaxWidth().then(inset),
        isError = shownIssue != null,
        supportingText = shownIssue?.let { stringResource(it.messageRes()) },
    )
    if (rate != null) {
        Text(rate.sentence, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = inset)
    }
}

/** The optional tip, typed in the account's currency; it lives in the fold with the date, time and note. */
@Composable
internal fun TipAmount(cross: CrossCurrency, invalid: Boolean, onChange: (String) -> Unit) {
    AmountField(
        value = cross.tip,
        onValueChange = onChange,
        digits = currencyDigits(cross.accountCurrency),
        centsFirst = LocalCentsFirst.current,
        label = stringResource(R.string.payment_tip_amount, cross.accountCurrency),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        isError = invalid,
        supportingText = if (invalid) stringResource(R.string.payment_error_tip_invalid) else null,
    )
}
