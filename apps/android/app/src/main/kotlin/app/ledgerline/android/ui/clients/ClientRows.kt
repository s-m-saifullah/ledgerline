package app.ledgerline.android.ui.clients

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.online.Online
import app.ledgerline.android.ui.design.AmountRow
import app.ledgerline.android.ui.design.LinkButton
import app.ledgerline.android.ui.design.tabular
import app.ledgerline.android.ui.format.formatMoment
import app.ledgerline.android.ui.format.formatServiceTime
import app.ledgerline.android.ui.home.Muted
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.api.HistoryEvent
import app.ledgerline.api.Service
import app.ledgerline.api.ServicePayment

/** A service is overdue when something is left on it and its due date has passed ([today] is `YYYY-MM-DD`). */
fun isOverdue(service: Service, today: String): Boolean =
    service.outstanding.amount > 0 && (service.dueDate ?: return false) < today

@Composable
private fun statusLabel(status: String): String = stringResource(
    when (status) {
        "partlyPaid" -> R.string.service_partly_paid
        "writtenOff" -> R.string.service_written_off
        "paid" -> R.string.service_paid
        else -> R.string.service_unpaid
    },
)

/**
 * `.service-row`: what it was, when, how it stands and what is left, with "Service X · Received Y"; a tap shows or
 * hides the payments received for it.
 */
@Composable
internal fun ServiceRow(
    service: Service,
    divider: Boolean,
    today: String,
    payments: Online<List<ServicePayment>>?,
    onTogglePayments: () -> Unit,
    onRetryPayments: () -> Unit,
) {
    val outstanding = money(service.outstanding.amount, service.outstanding.currency)
    val total = money(service.amount.amount, service.amount.currency)
    val received = money(service.received.amount, service.received.currency)
    val writtenOff = service.writtenOffAmount?.let { money(it.amount, it.currency) }
    val whenWhere = listOfNotNull(
        service.serviceDate + (service.serviceTime?.let { " · ${formatServiceTime(it)}" } ?: ""),
        statusLabel(service.status),
        service.dueDate?.let { stringResource(R.string.service_due, it) },
        stringResource(R.string.service_overdue).takeIf { isOverdue(service, today) },
    ).joinToString(" · ")
    val shownAmounts = listOfNotNull(
        stringResource(R.string.service_amounts, total.text, received.text),
        writtenOff?.let { stringResource(R.string.service_written_off_amount, it.text) },
    ).joinToString(" · ")
    val spokenAmounts = listOfNotNull(
        stringResource(R.string.service_amounts, total.spoken, received.spoken),
        writtenOff?.let { stringResource(R.string.service_written_off_amount, it.spoken) },
    ).joinToString(" · ")
    val toggle = stringResource(if (payments == null) R.string.payments_show else R.string.payments_hide)
    // The web hides this word from the eye and keeps it for a screen reader; so does the row.
    val outstandingWord = stringResource(R.string.service_outstanding)
    Column {
        AmountRow(
            title = service.description,
            details = listOf(whenWhere),
            amount = outstanding,
            under = null,
            described = listOf(service.description, "$outstandingWord ${outstanding.spoken}", whenWhere, spokenAmounts, toggle).joinToString(", "),
            divider = divider,
            extra = { Small(shownAmounts) },
            onClick = onTogglePayments,
        )
        if (payments != null) Payments(payments, onRetryPayments)
    }
}

/** `.client-payments`: the payments received for a service, or why they are not shown. */
@Composable
private fun Payments(state: Online<List<ServicePayment>>, onRetry: () -> Unit) {
    Column(modifier = Modifier.padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
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
    val whenText = entry.date + (entry.time?.let { " · ${formatServiceTime(it)}" } ?: "")
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

/**
 * One thing that happened to a client's services: its name, the service, the amount (a payment's, or the service's;
 * a corrected payment shows before and after), when it happened, what was left open, and any tip or waived amount.
 */
@Composable
internal fun HistoryRow(event: HistoryEvent, divider: Boolean) {
    val after = event.after
    val label = historyLabel(event.action)
    val payment = after.payment
    val amount = if (payment != null) money(payment.amount.amount, payment.amount.currency) else money(after.service.amount.amount, after.service.amount.currency)
    val before = event.before?.payment?.let { money(it.amount.amount, it.amount.currency) }
    val open = money(after.service.outstanding.amount, after.service.outstanding.currency)
    val tip = after.tip?.takeIf { it.deletedAt == null }?.let { money(it.amount.amount, it.amount.currency) }
    val waived = after.service.writtenOffAmount?.let { money(it.amount, it.currency) }
    val moment = formatMoment(event.createdAt)
    val shownMeta = listOfNotNull(
        stringResource(R.string.history_meta, moment, event.receivableVersion, open.text),
        tip?.let { stringResource(R.string.history_tip, it.text) },
        waived?.let { stringResource(R.string.history_waived, it.text) },
    ).joinToString(" · ")
    val spokenMeta = listOfNotNull(
        stringResource(R.string.history_meta, moment, event.receivableVersion, open.spoken),
        tip?.let { stringResource(R.string.history_tip, it.spoken) },
        waived?.let { stringResource(R.string.history_waived, it.spoken) },
    ).joinToString(" · ")
    val change = before?.let { stringResource(R.string.history_change, it.text, amount.text) }
    val changeSpoken = before?.let { stringResource(R.string.history_change, it.spoken, amount.spoken) }
    AmountRow(
        title = label,
        details = listOfNotNull(after.service.description, change),
        extra = {
            Small(shownMeta)
            after.service.writeOffReason?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        },
        amount = amount,
        under = null,
        described = listOfNotNull(label, after.service.description, changeSpoken ?: amount.spoken, spokenMeta, after.service.writeOffReason).joinToString(", "),
        divider = divider,
    )
}

/** A muted 12 sp line with tabular figures, as the web's `.row-meta`. */
@Composable
private fun Small(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall.tabular(), color = MaterialTheme.colorScheme.onSurfaceVariant)
}
