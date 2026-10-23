package app.ledgerline.android.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import app.ledgerline.android.R
import app.ledgerline.android.online.Online
import app.ledgerline.android.ui.design.CardGap
import app.ledgerline.android.ui.design.HeroCard
import app.ledgerline.android.ui.design.LedgerCard
import app.ledgerline.android.ui.design.RetryNote
import app.ledgerline.android.ui.design.StatCard
import app.ledgerline.android.ui.format.monthLabel
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.api.HomeSummary

/** This month, above the mirrored accounts: the web's In hand hero and stat cards, with the same words. */
@Composable
internal fun MonthCard(state: Online<HomeSummary>, onRetry: () -> Unit) {
    when (state) {
        Online.Loading -> LedgerCard { Muted(stringResource(R.string.home_loading)) }
        Online.Offline -> RetryNote(stringResource(R.string.home_offline), onRetry)
        Online.Failed -> RetryNote(stringResource(R.string.home_failed), onRetry)
        is Online.Ready -> if (state.value.setup.hasActiveAccount) Month(state.value)
    }
}

@Composable
private fun Month(home: HomeSummary) {
    val label = monthLabel(home.month)
    Column(verticalArrangement = Arrangement.spacedBy(CardGap)) {
        HeroCard(
            label = stringResource(R.string.home_in_hand),
            amount = money(home.inHand.amount, home.inHand.currency),
            notes = listOfNotNull(
                stringResource(R.string.home_in_hand_detail),
                home.unconvertedCurrencies.takeIf { it.isNotEmpty() }?.let {
                    pluralStringResource(R.plurals.home_unconverted, it.size, it.joinToString(", "))
                },
                home.pendingCount.toInt().takeIf { it > 0 }?.let { pluralStringResource(R.plurals.home_pending, it, it) },
            ),
        )
        StatCard(stringResource(R.string.home_money_in), money(home.moneyIn.amount, home.moneyIn.currency), stringResource(R.string.home_money_in_detail, label))
        StatCard(stringResource(R.string.home_money_out), money(home.moneyOut.amount, home.moneyOut.currency), stringResource(R.string.home_money_out_detail, label))
        val clients = home.owed.personCount.toInt()
        val from = if (clients == 0) stringResource(R.string.home_owed_nobody) else pluralStringResource(R.plurals.home_owed_from, clients, clients)
        val rates = when {
            home.owed.otherCurrencies.isEmpty() -> null
            home.owed.unconvertedCurrencies.isNotEmpty() ->
                stringResource(R.string.home_owed_rates_missing, home.owed.unconvertedCurrencies.joinToString(", "))
            else -> stringResource(R.string.home_owed_rates)
        }
        StatCard(stringResource(R.string.home_owed), money(home.owed.total.amount, home.owed.total.currency), listOfNotNull(from, rates).joinToString(" "))
        if (home.loans.lent.amount > 0) {
            StatCard(stringResource(R.string.home_lent), money(home.loans.lent.amount, home.loans.lent.currency), stringResource(R.string.home_lent_detail))
        }
        if (home.loans.borrowed.amount > 0) {
            StatCard(stringResource(R.string.home_borrowed), money(home.loans.borrowed.amount, home.loans.borrowed.currency), stringResource(R.string.home_borrowed_detail))
        }
    }
}
