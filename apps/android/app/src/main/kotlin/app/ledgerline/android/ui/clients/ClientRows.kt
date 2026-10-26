package app.ledgerline.android.ui.clients

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.online.Online
import app.ledgerline.android.ui.design.LinkButton
import app.ledgerline.android.ui.design.ListRow
import app.ledgerline.android.ui.design.StatusPill
import app.ledgerline.android.ui.design.tabular
import app.ledgerline.android.ui.format.formatEntryDate
import app.ledgerline.android.ui.format.formatMomentShort
import app.ledgerline.android.ui.format.formatServiceTime
import app.ledgerline.android.ui.format.formatShortDate
import app.ledgerline.android.ui.home.Muted
import app.ledgerline.android.ui.home.withPlus
import app.ledgerline.android.ui.privacy.LocalPrivacy
import app.ledgerline.android.ui.privacy.ShownMoney
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.api.HistoryEvent
import app.ledgerline.api.Service
import app.ledgerline.api.ServicePayment

/** A service is overdue when something is left on it and its due date has passed ([today] is `YYYY-MM-DD`). */
fun isOverdue(service: Service, today: String): Boolean =
    service.outstanding.amount > 0 && (service.dueDate ?: return false) < today

/**
 * A service: what it was, when it was done and what has been received, with Overdue beside the name when it is; at
 * the right what is left on it (an unpaid one) or what it cost with Paid in full (a paid one). A tap shows or hides
 * the payments received for it.
 */
@Composable
internal fun ServiceRow(
    service: Service,
    today: String,
    payments: Online<List<ServicePayment>>?,
    onTogglePayments: () -> Unit,
    onRetryPayments: () -> Unit,
) {
    val unpaid = isUnpaid(service)
    val shown = if (unpaid) service.outstanding else service.amount
    val amount = money(shown.amount, shown.currency)
    val received = money(service.received.amount, service.received.currency)
    val moment = whenOf(service)
    val hint = if (unpaid) stringResource(R.string.service_hint, moment, received.text) else moment
    val spokenHint = if (unpaid) stringResource(R.string.service_hint, moment, received.spoken) else moment
    val overdue = isOverdue(service, today)
    val overdueWord = stringResource(R.string.service_overdue)
    val status = when {
        unpaid -> null
        service.status == "writtenOff" -> stringResource(R.string.service_written_off)
        else -> stringResource(R.string.service_paid_in_full)
    }
    Column {
        ListRow(
            title = service.description,
            subtitle = hint,
            trailing = {
                Column(horizontalAlignment = Alignment.End) {
                    Text(amount.text, style = MaterialTheme.typography.titleMedium.tabular(), maxLines = 1, softWrap = false)
                    if (status != null) Text(status, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                }
            },
            badge = if (overdue) {
                { StatusPill(overdueWord) }
            } else {
                null
            },
            onClick = onTogglePayments,
            onClickLabel = stringResource(if (payments == null) R.string.payments_show else R.string.payments_hide),
            described = if (LocalPrivacy.current) {
                listOfNotNull(service.description, overdueWord.takeIf { overdue }, amount.spoken, spokenHint, status).joinToString(", ")
            } else {
                null
            },
        )
        if (payments != null) Box(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp)) { Payments(payments, onRetryPayments) }
    }
}

/** The payments received for a service, or why they are not shown. */
@Composable
private fun Payments(state: Online<List<ServicePayment>>, onRetry: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        when (state) {
            Online.Loading -> Muted(stringResource(R.string.payments_loading))
            Online.Offline -> Retry(stringResource(R.string.payments_offline), onRetry)
            Online.Failed -> Retry(stringResource(R.string.payments_failed), onRetry)
            is Online.Ready -> {
                if (state.value.isEmpty()) Muted(stringResource(R.string.payments_none))
                state.value.forEach { Payment(it) }
            }
        }
    }
}

@Composable
private fun Retry(text: String, onRetry: () -> Unit) {
    Muted(text)
    LinkButton(stringResource(R.string.try_again), onRetry)
}

/** One received payment: when it came, how much, its note and its tip. */
@Composable
private fun Payment(payment: ServicePayment) {
    val entry = payment.transaction
    val whenText = formatEntryDate(entry.date) + (entry.time?.let { " · ${formatServiceTime(it)}" } ?: "")
    val amount = money(payment.amount.amount, payment.amount.currency)
    val tip = payment.tip?.takeIf { it.deletedAt == null }?.let { money(it.amount.amount, it.amount.currency) }
    val shownTip = tip?.let { stringResource(R.string.payment_tip, it.text) }
    val spokenTip = tip?.let { stringResource(R.string.payment_tip, it.spoken) }
    Column(
        verticalArrangement = Arrangement.spacedBy(2.dp),
        modifier = Modifier.clearAndSetSemantics { contentDescription = listOfNotNull(whenText, amount.spoken, entry.note, spokenTip).joinToString(", ") },
    ) {
        Text("$whenText · ${amount.text}", style = MaterialTheme.typography.bodyMedium.tabular())
        entry.note?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        shownTip?.let { Text(it, style = MaterialTheme.typography.bodySmall.tabular(), color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

/** Which way an event moves what the client owes: +1 more, -1 less, 0 neither (a correction, a write-off, a reopening). */
fun historySign(action: String): Int = when (action) {
    "created", "restored", "paymentDeleted" -> 1
    "deleted", "paymentCreated", "paymentRestored" -> -1
    else -> 0
}

private fun isPaymentEvent(action: String) = action.startsWith("payment")

@Composable
private fun historyLabel(action: String): String = stringResource(
    when (action) {
        "created" -> R.string.history_created
        "edited" -> R.string.history_edited
        "deleted" -> R.string.history_deleted
        "restored" -> R.string.history_restored
        "writtenOff" -> R.string.history_written_off
        "reopened" -> R.string.history_reopened
        "paymentCreated" -> R.string.history_payment_created
        "paymentEdited" -> R.string.history_payment_edited
        "paymentDeleted" -> R.string.history_payment_deleted
        else -> R.string.history_payment_restored
    },
)

/** An amount with its direction: a plus for more owed, a minus for less; a hidden one keeps its mask. */
@Composable
private fun signedMoney(amount: Long, currency: String, sign: Int): ShownMoney =
    if (sign < 0) money(-amount, currency) else money(amount, currency).let { if (sign > 0) it.withPlus(amount) else it }

/** A line of history: an event on its own, or a few of one kind written together. */
@Composable
internal fun HistoryLineRow(line: HistoryLine) {
    when (line) {
        is HistoryLine.Single -> SingleLine(line.event)
        is HistoryLine.Batch -> BatchLine(line)
    }
}

/**
 * One event: its name (with the service, or a payment's tip), then when it happened and what was left on the
 * service after it (a corrected payment shows before and after); the amount at the right, signed by which way it
 * moved what the client owes.
 */
@Composable
private fun SingleLine(event: HistoryEvent) {
    val after = event.after
    val action = event.action
    val label = historyLabel(action)
    val payment = after.payment
    val sign = historySign(action)
    val amount = signedMoney(amountOf(event), currencyOf(event), sign)
    val before = event.before?.payment?.let { money(it.amount.amount, it.amount.currency) }
    val open = money(after.service.outstanding.amount, after.service.outstanding.currency)
    val tip = after.tip?.takeIf { it.deletedAt == null }?.let { money(it.amount.amount, it.amount.currency) }
    val waived = after.service.writtenOffAmount?.let { money(it.amount, it.currency) }
    val moment = formatMomentShort(event.createdAt)
    val description = after.service.description
    val title = when {
        isPaymentEvent(action) && tip != null -> stringResource(R.string.history_with, label, stringResource(R.string.history_tip_inline, tip.text))
        isPaymentEvent(action) -> label
        else -> stringResource(R.string.history_with, label, description)
    }
    val spokenTitle = when {
        isPaymentEvent(action) && tip != null -> stringResource(R.string.history_with, label, stringResource(R.string.history_tip_inline, tip.spoken))
        else -> title
    }
    @Composable fun parts(shown: (ShownMoney) -> String, changed: String?) = listOfNotNull(
        description.takeIf { isPaymentEvent(action) },
        changed,
        moment,
    ).plus(listOfNotNull(
        stringResource(R.string.history_left, shown(open)),
        waived?.let { stringResource(R.string.history_waived, shown(it)) },
    ))
    val change = before?.let { stringResource(R.string.history_change, it.text, money(payment?.amount?.amount ?: 0, payment?.amount?.currency ?: "USD").text) }
    val changeSpoken = before?.let { stringResource(R.string.history_change, it.spoken, money(payment?.amount?.amount ?: 0, payment?.amount?.currency ?: "USD").spoken) }
    val hint = parts({ it.text }, change).joinToString(" · ")
    val spokenHint = parts({ it.spoken }, changeSpoken).joinToString(" · ")
    ListRow(
        title = title,
        subtitle = hint,
        trailing = { Text(amount.text, style = MaterialTheme.typography.titleMedium.tabular(), maxLines = 1, softWrap = false) },
        described = if (LocalPrivacy.current) listOfNotNull(spokenTitle, amount.spoken, spokenHint, after.service.writeOffReason).joinToString(", ") else null,
        extra = after.service.writeOffReason?.let { reason -> { Text(reason, style = MaterialTheme.typography.bodySmall) } },
    )
}

/**
 * A few services logged, or payments received, together: "3 payments received" with each amount, and the total at
 * the right (services show the dates they cover instead of the moment).
 */
@Composable
private fun BatchLine(batch: HistoryLine.Batch) {
    val payments = isPaymentEvent(batch.action)
    val count = batch.events.size
    val title = if (payments) pluralStringResource(R.plurals.history_batch_payments, count, count) else pluralStringResource(R.plurals.history_batch_services, count, count)
    val sign = historySign(batch.action)
    val total = signedMoney(batch.total, batch.currency, sign)
    val each = batch.events.map { money(amountOf(it), batch.currency) }
    val lead = if (payments) {
        formatMomentShort(batch.events.first().createdAt)
    } else {
        serviceDateRange(batch.events).let { (from, to) -> if (from == to) formatShortDate(from) else "${formatShortDate(from)}–${formatShortDate(to)}" }
    }
    val hint = stringResource(R.string.history_hint_amounts, lead, each.joinToString(" + ") { it.text })
    val spokenHint = stringResource(R.string.history_hint_amounts, lead, each.joinToString(" + ") { it.spoken })
    ListRow(
        title = title,
        subtitle = hint,
        trailing = { Text(total.text, style = MaterialTheme.typography.titleMedium.tabular(), maxLines = 1, softWrap = false) },
        described = if (LocalPrivacy.current) listOf(title, total.spoken, spokenHint).joinToString(", ") else null,
    )
}
