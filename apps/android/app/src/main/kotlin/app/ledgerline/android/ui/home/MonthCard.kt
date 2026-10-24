package app.ledgerline.android.ui.home

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.online.Online
import app.ledgerline.android.ui.design.CardGap
import app.ledgerline.android.ui.design.HeroCard
import app.ledgerline.android.ui.design.HeroFigure
import app.ledgerline.android.ui.design.LedgerCard
import app.ledgerline.android.ui.design.LimitState
import app.ledgerline.android.ui.design.ProportionBar
import app.ledgerline.android.ui.design.RetryNote
import app.ledgerline.android.ui.design.tabular
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.android.ui.theme.LocalPalette
import app.ledgerline.api.HomeSummary

/** This month, above the mirrored accounts: the In hand hero and one money in and out card that opens Insights. */
@Composable
internal fun MonthCard(state: Online<HomeSummary>, onRetry: () -> Unit, onOpenInsights: () -> Unit) {
    when (state) {
        Online.Loading -> LedgerCard { Muted(stringResource(R.string.home_loading)) }
        Online.Offline -> RetryNote(stringResource(R.string.home_offline), onRetry)
        Online.Failed -> RetryNote(stringResource(R.string.home_failed), onRetry)
        is Online.Ready -> if (state.value.setup.hasActiveAccount) Month(state.value, onOpenInsights)
    }
}

@Composable
private fun Month(home: HomeSummary, onOpenInsights: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(CardGap)) {
        val clients = home.owed.personCount.toInt()
        val rates = when {
            home.owed.otherCurrencies.isEmpty() -> null
            home.owed.unconvertedCurrencies.isNotEmpty() ->
                stringResource(R.string.home_owed_rates_missing, home.owed.unconvertedCurrencies.joinToString(", "))
            else -> stringResource(R.string.home_owed_rates)
        }
        HeroCard(
            label = stringResource(R.string.home_in_hand),
            amount = money(home.inHand.amount, home.inHand.currency),
            figures = listOfNotNull(
                home.owed.total.takeIf { it.amount > 0 }?.let { HeroFigure(if (clients > 0) stringResource(R.string.home_owed_count, clients) else stringResource(R.string.home_owed), money(it.amount, it.currency)) },
                home.loans.lent.takeIf { it.amount > 0 }?.let { HeroFigure(stringResource(R.string.home_lent), money(it.amount, it.currency)) },
                home.loans.borrowed.takeIf { it.amount > 0 }?.let { HeroFigure(stringResource(R.string.home_borrowed), money(it.amount, it.currency)) },
            ),
            // Only what the figures need said: a missing rate or an account left out. No explanation of what In hand counts.
            notes = listOfNotNull(
                rates,
                home.unconvertedCurrencies.takeIf { it.isNotEmpty() }?.let {
                    pluralStringResource(R.plurals.home_unconverted, it.size, it.joinToString(", "))
                },
            ),
        )
        CashFlowCard(home, onOpenInsights)
    }
}

/** Money in and money out as one bar with the net beside it; a tap opens Insights. The bar shows a share, never an amount. */
@Composable
private fun CashFlowCard(home: HomeSummary, onOpen: () -> Unit) {
    val palette = LocalPalette.current
    val moneyIn = money(home.moneyIn.amount, home.moneyIn.currency)
    val moneyOut = money(home.moneyOut.amount, home.moneyOut.currency)
    val flow = cashFlow(home.moneyIn, home.moneyOut)
    val net = flow?.let { money(it.net.amount, it.net.currency) }
    val title = stringResource(R.string.home_this_month)
    val inLabel = stringResource(R.string.home_money_in)
    val outLabel = stringResource(R.string.home_money_out)
    val netText = net?.let { stringResource(R.string.home_net, it.text) }
    val described = listOfNotNull(
        title, "$inLabel ${moneyIn.spoken}", "$outLabel ${moneyOut.spoken}", net?.let { stringResource(R.string.home_net, it.spoken) },
        stringResource(R.string.home_open_insights),
    ).joinToString(", ")
    LedgerCard(
        modifier = Modifier
            .clickable(onClick = onOpen, role = Role.Button)
            .clearAndSetSemantics { contentDescription = described },
        padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 20.dp, vertical = 16.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val netChip: @Composable () -> Unit = {
                if (netText != null) {
                    Surface(
                        shape = MaterialTheme.shapes.extraSmall,
                        color = palette.surface,
                        border = BorderStroke(1.dp, palette.border),
                        contentColor = if (flow.state == LimitState.Over) palette.danger else palette.accent,
                    ) {
                        Text(netText, style = MaterialTheme.typography.labelLarge.tabular(), modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp), maxLines = 1)
                    }
                }
            }
            val heading: @Composable (Modifier) -> Unit = { Text(title, style = MaterialTheme.typography.titleSmall, modifier = it.semantics { heading() }) }
            val chevron: @Composable () -> Unit = { Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null, tint = palette.muted, modifier = Modifier.padding(start = 4.dp)) }
            if (LocalDensity.current.fontScale > 1.3f) {
                // The largest text: the title and its chevron, then the net under them.
                Row(verticalAlignment = Alignment.CenterVertically) { heading(Modifier.weight(1f)); chevron() }
                netChip()
            } else {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.heightIn(min = 32.dp)) {
                    heading(Modifier.weight(1f))
                    netChip()
                    chevron()
                }
            }
            if (flow != null) ProportionBar(flow.share, flow.state)
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(inLabel, style = MaterialTheme.typography.bodySmall, color = palette.muted)
                    Text(moneyIn.text, style = MaterialTheme.typography.titleMedium.tabular(), maxLines = 1, softWrap = false)
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(outLabel, style = MaterialTheme.typography.bodySmall, color = palette.muted)
                    Text(moneyOut.text, style = MaterialTheme.typography.titleMedium.tabular(), maxLines = 1, softWrap = false)
                }
            }
        }
    }
}
