package app.ledgerline.android.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.online.Online
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.api.HomeSummary
import app.ledgerline.api.Money
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale

/** "October 2026" for "2026-10", in the phone's language. */
fun monthLabel(month: String, locale: Locale = Locale.getDefault()): String =
    YearMonth.parse(month).format(DateTimeFormatter.ofPattern("LLLL yyyy", locale))

/** This month, above the mirrored accounts: the same figures and words as the web's Home. */
@Composable
internal fun MonthCard(state: Online<HomeSummary>, onRetry: () -> Unit) {
    when (state) {
        Online.Loading -> Note(stringResource(R.string.home_loading))
        Online.Offline -> Note(stringResource(R.string.home_offline), onRetry)
        Online.Failed -> Note(stringResource(R.string.home_failed), onRetry)
        is Online.Ready -> if (state.value.setup.hasActiveAccount) Month(state.value)
    }
}

@Composable
private fun Month(home: HomeSummary) {
    val label = monthLabel(home.month)
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        Text(
            label,
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 8.dp).semantics { heading() },
        )
        InHand(home)
        Figure(stringResource(R.string.home_money_in), home.moneyIn, stringResource(R.string.home_money_in_detail, label))
        Figure(stringResource(R.string.home_money_out), home.moneyOut, stringResource(R.string.home_money_out_detail, label))
        val clients = home.owed.personCount.toInt()
        val from = if (clients == 0) stringResource(R.string.home_owed_nobody) else pluralStringResource(R.plurals.home_owed_from, clients, clients)
        val rates = when {
            home.owed.otherCurrencies.isEmpty() -> null
            home.owed.unconvertedCurrencies.isNotEmpty() ->
                stringResource(R.string.home_owed_rates_missing, home.owed.unconvertedCurrencies.joinToString(", "))
            else -> stringResource(R.string.home_owed_rates)
        }
        Figure(stringResource(R.string.home_owed), home.owed.total, listOfNotNull(from, rates).joinToString(" "))
        if (home.loans.lent.amount > 0) {
            Figure(stringResource(R.string.home_lent), home.loans.lent, stringResource(R.string.home_lent_detail))
        }
        if (home.loans.borrowed.amount > 0) {
            Figure(stringResource(R.string.home_borrowed), home.loans.borrowed, stringResource(R.string.home_borrowed_detail))
        }
    }
}

@Composable
private fun InHand(home: HomeSummary) {
    val amount = money(home.inHand.amount, home.inHand.currency)
    val title = stringResource(R.string.home_in_hand)
    val notes = listOfNotNull(
        stringResource(R.string.home_in_hand_detail),
        home.unconvertedCurrencies.takeIf { it.isNotEmpty() }?.let {
            pluralStringResource(R.plurals.home_unconverted, it.size, it.joinToString(", "))
        },
        home.pendingCount.toInt().takeIf { it > 0 }?.let { pluralStringResource(R.plurals.home_pending, it, it) },
    )
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 12.dp)
            .clearAndSetSemantics { contentDescription = (listOf(title, amount.spoken) + notes).joinToString(", ") },
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(amount.text, style = MaterialTheme.typography.displaySmall.tabular())
        notes.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
    HorizontalDivider()
}

@Composable
private fun Figure(title: String, value: Money, detail: String) {
    val amount = money(value.amount, value.currency)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .padding(vertical = 10.dp)
            .clearAndSetSemantics { contentDescription = listOf(title, amount.spoken, detail).joinToString(", ") },
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            Text(amount.text, style = MaterialTheme.typography.titleMedium.tabular(), modifier = Modifier.padding(start = 12.dp))
        }
        Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    HorizontalDivider()
}

@Composable
private fun Note(text: String, onRetry: (() -> Unit)? = null) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).heightIn(min = 48.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        if (onRetry != null) {
            TextButton(onClick = onRetry, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.try_again)) }
        }
    }
}
