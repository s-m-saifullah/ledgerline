package app.ledgerline.android.ui.clients

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.ui.design.GroupedListCard
import app.ledgerline.android.ui.design.InputRow
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SecondaryButton
import app.ledgerline.android.ui.editor.AmountField
import app.ledgerline.android.ui.editor.LocalCentsFirst
import app.ledgerline.android.ui.editor.currencyDigits
import app.ledgerline.android.ui.editor.invertRate
import app.ledgerline.android.ui.privacy.money

/*
 * The fields an account in another currency adds to a payment sheet (ADR 0050, slices 4b-1 and 4b-2), shared by the sheet
 * for one service and the sheet for a client: what arrived, the rate the two amounts fix (or, when neither side is the base
 * currency, the rate the ledger stores and a way to set it by hand), and an optional tip in the account's currency. They
 * are only drawn when the account's currency differs from the service's.
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

/**
 * Under the amount received, when neither side is the base currency (the web's `EntryRate`): what it is worth in the base
 * currency, which rate that uses and where it comes from, or why there is none; and a way to set the rate yourself, read
 * base currency first ("1 USD is worth 122.5 GBP"). What is typed is only sent when it can be stored; "Use the stored rate"
 * drops it. Opening the field shows the rate in use, which is not a change until the person types.
 */
@Composable
internal fun AccountRate(cross: CrossCurrency, date: String, onTyped: (String) -> Unit) {
    if (!cross.needsRate) return
    val inset = Modifier.padding(horizontal = ScreenMargin)
    val account = cross.accountCurrency
    var editing by remember(account) { mutableStateOf(cross.rateTyped.isNotEmpty()) }
    var text by remember(account) { mutableStateOf(cross.rateTyped) }
    val rate = cross.rateInUse
    val stored = cross.stored
    val missing = cross.rateMissing
    val line = when {
        rate != null -> {
            val source = when {
                cross.manualRate != null -> stringResource(R.string.payment_rate_source_manual)
                stored is StoredRate.Found && stored.rateDate != null && stored.rateDate != date -> stringResource(R.string.payment_rate_source_dated, stored.rateDate)
                else -> null
            }
            val sentence = CrossRate(account, rate).sentence + (source?.let { " ($it)" } ?: "")
            cross.baseValue()?.let { stringResource(R.string.payment_rate_about, money(it, BaseCurrency).text) + " · " + sentence } ?: sentence
        }
        missing -> stringResource(R.string.payment_rate_missing, account)
        stored == StoredRate.Unavailable -> stringResource(R.string.payment_rate_unavailable)
        else -> stringResource(R.string.payment_rate_looking)
    }
    // The grouped card brings its own side margin, so only the line and the buttons are inset to line up with it.
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            line,
            style = MaterialTheme.typography.bodyMedium,
            color = if (missing) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = inset.semantics { liveRegion = LiveRegionMode.Polite },
        )
        if (!editing) {
            SecondaryButton(
                stringResource(R.string.payment_rate_set),
                onClick = {
                    editing = true
                    text = rate?.let { invertRate(it) }.orEmpty()
                },
                modifier = Modifier.fillMaxWidth().then(inset),
            )
        } else {
            GroupedListCard {
                row {
                    InputRow(
                        label = stringResource(R.string.payment_rate_field, BaseCurrency, account),
                        value = text,
                        onChange = { typed ->
                            text = typed
                            onTyped(typed)
                        },
                        stacked = true,
                        error = if (cross.rateTypedIssue) stringResource(R.string.payment_rate_invalid) else null,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    )
                }
            }
            SecondaryButton(
                stringResource(R.string.payment_rate_use_stored),
                onClick = {
                    editing = false
                    text = ""
                    onTyped("")
                },
                modifier = Modifier.fillMaxWidth().then(inset),
            )
        }
    }
}
