package app.ledgerline.android.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import app.ledgerline.android.R
import app.ledgerline.android.mirror.AccountBalance
import app.ledgerline.android.online.Online
import app.ledgerline.android.ui.design.AmountRow
import app.ledgerline.android.ui.design.CardGap
import app.ledgerline.android.ui.design.LedgerCard
import app.ledgerline.android.ui.design.ListCard
import app.ledgerline.android.ui.design.PageHeader
import app.ledgerline.android.ui.format.monthLabel
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.api.HomeSummary
import java.time.YearMonth

/**
 * Home as on the web (ADR 0045): the header with the month, the sync line, this month read online (In hand
 * and the stat cards), then the accounts from the mirror, which work offline.
 */
@Composable
internal fun HomeContent(
    header: @Composable () -> Unit,
    month: Online<HomeSummary>,
    onRetry: () -> Unit,
    accounts: Mirrored<AccountBalance>,
    onOpenPending: () -> Unit,
    modifier: Modifier = Modifier,
    banner: (@Composable () -> Unit)? = null,
) {
    val shownMonth = (month as? Online.Ready)?.value?.month ?: YearMonth.now().toString()
    LazyColumn(modifier = modifier, contentPadding = PaddingValues(bottom = ListBottomSpace), verticalArrangement = Arrangement.spacedBy(CardGap)) {
        if (banner != null) item { banner() }
        item {
            PageHeader(stringResource(R.string.home_title), eyebrow = stringResource(R.string.eyebrow_personal), subtitle = monthLabel(shownMonth))
            header()
        }
        item { MonthCard(month, onRetry, onOpenPending) }
        when (accounts) {
            Mirrored.Waiting -> item { LedgerCard { Muted(stringResource(R.string.mirror_waiting)) } }
            is Mirrored.Ready -> {
                val (active, archived) = accounts.items.partition { it.archivedAt == null }
                item {
                    ListCard(stringResource(R.string.accounts_title)) {
                        if (active.isEmpty()) Muted(stringResource(R.string.accounts_empty))
                        active.forEachIndexed { index, account -> AccountRow(account, divider = index > 0) }
                    }
                }
                if (archived.isNotEmpty()) {
                    item {
                        ListCard(stringResource(R.string.accounts_archived)) {
                            archived.forEachIndexed { index, account -> AccountRow(account, divider = index > 0) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun Muted(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** The web's account row: the name, its type (and Overdrawn when below zero), the balance. */
@Composable
internal fun AccountRow(account: AccountBalance, divider: Boolean = false) {
    val balance = money(account.balance, account.currency)
    val type = stringResource(accountTypeLabel(account.type))
    val kind = if (account.balance < 0) stringResource(R.string.account_overdrawn, type) else type
    val pending = if (account.pending > 0) pluralStringResource(R.plurals.accounts_pending_plural, account.pending, account.pending) else null
    AmountRow(
        title = account.name,
        details = listOfNotNull(kind, pending),
        amount = balance,
        under = null,
        described = listOfNotNull(account.name, balance.spoken, kind, pending).joinToString(", "),
        divider = divider,
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
