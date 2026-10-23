package app.ledgerline.android.ui.more

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import app.ledgerline.android.R
import app.ledgerline.android.ui.design.CardGap
import app.ledgerline.android.ui.design.NavCard
import app.ledgerline.android.ui.design.PageHeader

/** What More's cards open. */
class MoreActions(
    val openClients: () -> Unit,
    val openLoans: () -> Unit,
    val openSettings: () -> Unit,
)

/** More as on the web: a header and one navigation card each for Clients, Loans and Settings (ADR 0045). */
@Composable
fun MoreContent(actions: MoreActions, bottomSpace: Dp, modifier: Modifier = Modifier) {
    LazyColumn(modifier = modifier, contentPadding = PaddingValues(bottom = bottomSpace), verticalArrangement = Arrangement.spacedBy(CardGap)) {
        item {
            PageHeader(
                stringResource(R.string.more_title),
                eyebrow = stringResource(R.string.eyebrow_yours),
                subtitle = stringResource(R.string.more_subtitle),
            )
        }
        item { NavCard(R.drawable.ic_wallet, stringResource(R.string.more_clients_title), stringResource(R.string.more_clients_detail), actions.openClients) }
        item { NavCard(R.drawable.ic_hand_coins, stringResource(R.string.more_loans_title), stringResource(R.string.more_loans_detail), actions.openLoans) }
        item { NavCard(R.drawable.ic_settings, stringResource(R.string.more_settings_title), stringResource(R.string.more_settings_detail), actions.openSettings) }
    }
}
