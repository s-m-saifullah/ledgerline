package app.ledgerline.android.ui.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import app.ledgerline.android.R
import app.ledgerline.android.mirror.AccountBalance
import app.ledgerline.android.online.Online
import app.ledgerline.android.ui.design.Avatar
import app.ledgerline.android.ui.design.CardGap
import app.ledgerline.android.ui.design.EmptyState
import app.ledgerline.android.ui.design.FilterChip
import app.ledgerline.android.ui.design.GroupedListCard
import app.ledgerline.android.ui.design.LedgerCard
import app.ledgerline.android.ui.design.ListRow
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SectionLabel
import app.ledgerline.android.ui.design.SegmentedControl
import app.ledgerline.android.ui.design.TopBar
import app.ledgerline.android.ui.design.tabular
import app.ledgerline.android.ui.format.monthLabel
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.android.ui.theme.LocalPalette
import app.ledgerline.api.HomeSummary
import java.time.YearMonth

/** What Home can do, so its content stays a function of plain data. */
internal data class HomeActions(
    val onRetry: () -> Unit,
    val onOpenPending: () -> Unit,
    val onOpenInsights: () -> Unit,
    val onSelectCurrency: (String?) -> Unit,
    val onToggleHide: () -> Unit,
    val onRetrySync: () -> Unit,
    val onOpenAttention: () -> Unit,
)

/**
 * Home (ADR 0046): a fixed top bar with the month and the Hide amounts switch, the sync state, the banners in one
 * slot, this month read online (the In hand hero and one money in and out card), then the accounts from the
 * mirror, which work offline, in two groups.
 */
@Composable
internal fun HomeContent(
    status: SyncStatus,
    month: Online<HomeSummary>,
    accounts: Mirrored<AccountBalance>,
    currency: String?,
    hidden: Boolean,
    actions: HomeActions,
    modifier: Modifier = Modifier,
    banner: (@Composable () -> Unit)? = null,
) {
    val ready = (month as? Online.Ready)?.value
    val shownMonth = ready?.month ?: YearMonth.now().toString()
    Column(modifier = modifier) {
        TopBar(monthLabel(shownMonth), action = { FilterChip(stringResource(R.string.privacy_mode), hidden, actions.onToggleHide) })
        LazyColumn(contentPadding = PaddingValues(bottom = ListBottomSpace), verticalArrangement = Arrangement.spacedBy(CardGap)) {
            item { SyncStatusRow(status, actions.onRetrySync) }
            // The banners: the update notice, what needs the owner, and what is pending.
            if (banner != null) item { banner() }
            if (status.attention > 0) {
                item {
                    Note(
                        pluralStringResource(R.plurals.attention_banner, status.attention, status.attention),
                        actions.onOpenAttention,
                    )
                }
            }
            if (ready != null && ready.setup.hasActiveAccount && ready.pendingCount > 0) {
                item {
                    val count = ready.pendingCount.toInt()
                    Note(pluralStringResource(R.plurals.home_pending, count, count), actions.onOpenPending, stringResource(R.string.home_show_pending))
                }
            }
            item { MonthCard(month, actions.onRetry, actions.onOpenInsights) }
            when (accounts) {
                Mirrored.Waiting -> item { LedgerCard { Muted(stringResource(R.string.mirror_waiting)) } }
                is Mirrored.Ready -> accountItems(accounts.items, currency, actions.onSelectCurrency)
            }
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.accountItems(all: List<AccountBalance>, currency: String?, onSelect: (String?) -> Unit) {
    val (active, archived) = all.partition { it.archivedAt == null }
    if (active.isEmpty() && archived.isEmpty()) {
        item { EmptyState(stringResource(R.string.accounts_empty)) }
        return
    }
    val currencies = currenciesOf(active)
    // A chosen currency that no account has any more (the last one was archived) shows everything.
    val chosen = currency?.takeIf { it in currencies }
    if (currencies.size > 1) {
        item {
            val options = listOf(null) + currencies
            SegmentedControl(
                options.map { it ?: stringResource(R.string.home_all_currencies) },
                selected = options.indexOf(chosen),
                onSelect = { onSelect(options[it]) },
                modifier = Modifier.padding(horizontal = ScreenMargin),
            )
        }
    }
    groupAccounts(active, chosen).forEach { group ->
        item {
            val title = stringResource(if (group.kind == AccountKind.Liquid) R.string.accounts_cash else R.string.accounts_debt)
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SectionLabel("$title (${group.items.size})")
                GroupedListCard { group.items.forEach { account -> row { AccountRow(account) } } }
            }
        }
    }
    val archivedShown = archived.filter { chosen == null || it.currency == chosen }
    if (archivedShown.isNotEmpty()) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SectionLabel(stringResource(R.string.accounts_archived))
                GroupedListCard { archivedShown.forEach { account -> row { AccountRow(account) } } }
            }
        }
    }
}

/** One line of news above the hero in a bordered card, so it is not mistaken for the hero's own notes; the whole card opens [onClick]. */
@Composable
internal fun Note(text: String, onClick: () -> Unit, action: String? = null) {
    LedgerCard(
        modifier = Modifier.clickable(onClickLabel = action, onClick = onClick, role = Role.Button),
        padding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.heightIn(min = 40.dp)) {
            Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null, tint = LocalPalette.current.muted)
        }
    }
}

@Composable
internal fun Muted(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/**
 * An account: its first letters, the name, its type (with Overdrawn in red for money to hand below zero; a card
 * or loan is below zero by nature, so it does not say so) and the balance.
 */
@Composable
internal fun AccountRow(account: AccountBalance) {
    val balance = money(account.balance, account.currency)
    val type = stringResource(accountTypeLabel(account.type))
    val overdrawn = account.balance < 0 && accountKind(account.type) == AccountKind.Liquid
    val kind = if (overdrawn) stringResource(R.string.account_overdrawn, type) else type
    val pending = if (account.pending > 0) pluralStringResource(R.plurals.accounts_pending_plural, account.pending, account.pending) else null
    ListRow(
        title = account.name,
        subtitle = listOfNotNull(kind, pending).joinToString(" · "),
        subtitleColor = if (overdrawn) LocalPalette.current.danger else androidx.compose.ui.graphics.Color.Unspecified,
        leading = { Avatar(account.name) },
        trailing = { Text(balance.text, style = MaterialTheme.typography.titleMedium.tabular(), maxLines = 1, softWrap = false) },
        described = listOfNotNull(account.name, balance.spoken, kind, pending).joinToString(", "),
    )
}

fun accountTypeLabel(type: String): Int = when (type) {
    "bank" -> R.string.account_type_bank
    "cash" -> R.string.account_type_cash
    "card" -> R.string.account_type_card
    "wallet" -> R.string.account_type_wallet
    "loan" -> R.string.account_type_loan
    "savings" -> R.string.account_type_savings
    else -> R.string.account_type_other
}
