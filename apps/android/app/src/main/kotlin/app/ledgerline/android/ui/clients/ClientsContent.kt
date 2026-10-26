package app.ledgerline.android.ui.clients

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Row
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
import app.ledgerline.android.online.Paged
import app.ledgerline.android.ui.design.Avatar
import app.ledgerline.android.ui.design.CardGap
import app.ledgerline.android.ui.design.EmptyState
import app.ledgerline.android.ui.design.FilterChip
import app.ledgerline.android.ui.design.GroupedListCard
import app.ledgerline.android.ui.design.LedgerCard
import app.ledgerline.android.ui.design.ListRow
import app.ledgerline.android.ui.design.LoadMore
import app.ledgerline.android.ui.design.RetryNote
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SearchBox
import app.ledgerline.android.ui.design.SectionLabel
import app.ledgerline.android.ui.design.SegmentedControl
import app.ledgerline.android.ui.design.TopBar
import app.ledgerline.android.ui.design.tabular
import app.ledgerline.android.ui.format.formatEntryDate
import app.ledgerline.android.ui.format.formatServiceTime
import app.ledgerline.android.ui.format.formatShortDate
import app.ledgerline.android.ui.home.ListBottomSpace
import app.ledgerline.android.ui.home.Muted
import app.ledgerline.android.ui.privacy.LocalPrivacy
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.android.ui.theme.LocalPalette
import app.ledgerline.api.Contact
import app.ledgerline.api.HistoryEvent
import app.ledgerline.api.Service
import app.ledgerline.api.ServicePayment
import java.time.LocalDate

/** What the clients list's controls show and do, as plain data. */
class ClientsListActions(
    val onBack: () -> Unit,
    val onSearch: (String) -> Unit,
    val onFilter: (ClientFilter) -> Unit,
    val onOpen: (String) -> Unit,
    val onMore: () -> Unit,
    val onRetry: () -> Unit,
)

/**
 * Clients (ADR 0046), read-only: a fixed top bar with the search box and the Open, Settled and All chips under it
 * (so a shorter result can never move them), then, scrolling, what the open clients owe together and one grouped
 * card of clients, those who owe the most first. Adding a client stays on the web (ADR 0043).
 */
@Composable
internal fun ClientsListContent(
    text: String,
    filter: ClientFilter,
    state: Online<Paged<Contact>>,
    actions: ClientsListActions,
    modifier: Modifier = Modifier,
    today: LocalDate = LocalDate.now(),
) {
    Column(modifier) {
        TopBar(stringResource(R.string.clients_title), onBack = actions.onBack)
        val loaded = (state as? Online.Ready)?.value?.items.orEmpty()
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            SearchBox(stringResource(R.string.clients_search), text, actions.onSearch, Modifier.padding(horizontal = ScreenMargin))
            Row(modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = ScreenMargin), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val open = loaded.count { matches(it, ClientFilter.Open) }
                FilterChip(stringResource(R.string.client_filter_open, open), filter == ClientFilter.Open) { actions.onFilter(ClientFilter.Open) }
                FilterChip(stringResource(R.string.client_filter_settled), filter == ClientFilter.Settled) { actions.onFilter(ClientFilter.Settled) }
                FilterChip(stringResource(R.string.client_filter_all), filter == ClientFilter.All) { actions.onFilter(ClientFilter.All) }
            }
        }
        LazyColumn(contentPadding = PaddingValues(top = CardGap, bottom = ListBottomSpace), verticalArrangement = Arrangement.spacedBy(CardGap)) {
            when (state) {
                Online.Loading -> item { LedgerCard { Muted(stringResource(R.string.clients_loading)) } }
                Online.Offline -> item { RetryNote(stringResource(R.string.clients_offline), actions.onRetry) }
                Online.Failed -> item { RetryNote(stringResource(R.string.clients_failed), actions.onRetry) }
                is Online.Ready -> clientItems(state.value, text, filter, actions, today)
            }
        }
    }
}

private fun LazyListScope.clientItems(paged: Paged<Contact>, text: String, filter: ClientFilter, actions: ClientsListActions, today: LocalDate) {
    val shown = visibleClients(paged.items, filter)
    // What they owe together is of everyone, not of a search's few; it waits for a search to be cleared.
    if (text.isEmpty()) clientsTotal(paged.items)?.let { total -> item { TotalCard(total) } }
    if (shown.isEmpty()) {
        item {
            EmptyState(
                stringResource(
                    when {
                        text.isNotEmpty() -> R.string.clients_empty_none
                        paged.items.isEmpty() -> R.string.clients_empty
                        filter == ClientFilter.Open -> R.string.clients_nobody_owes
                        else -> R.string.clients_no_settled
                    },
                ),
            )
        }
    } else {
        item { GroupedListCard { shown.forEach { client -> row { ClientRow(client, today) { actions.onOpen(client.id) } } } } }
    }
    if (paged.hasMore) {
        item { LoadMore(stringResource(R.string.load_more_clients), paged.loadingMore, paged.moreFailed, actions.onMore) }
    }
}

/** What the open clients owe together, and how many of them; with a foreign currency without a rate, which is left out. */
@Composable
private fun TotalCard(total: ClientsTotal) {
    val owed = money(total.amount.amount, total.amount.currency)
    val label = stringResource(R.string.client_total_label)
    val count = pluralStringResource(R.plurals.more_clients_owe, total.clients, total.clients)
    val missing = total.unconverted.takeIf { it.isNotEmpty() }?.let { stringResource(R.string.client_total_missing, it.joinToString(", ")) }
    val spoken = listOfNotNull(label, owed.spoken, count, missing).joinToString(", ")
    LedgerCard(
        modifier = if (owed.spoken != owed.text) Modifier.clearAndSetSemantics { contentDescription = spoken } else Modifier,
        padding = PaddingValues(16.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(owed.text, style = MaterialTheme.typography.displaySmall.tabular(), maxLines = 1, softWrap = false)
            Text(count, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (missing != null) Text(missing, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** The hint under a client: how long ago the oldest unpaid service was, and when; or that nothing is open. */
@Composable
internal fun unpaidHint(client: Contact, today: LocalDate): String {
    val date = client.oldestOpenServiceDate ?: return stringResource(R.string.client_no_open)
    val days = daysAgo(date, today) ?: return stringResource(R.string.client_oldest_unpaid, date)
    val ago = if (days == 0L) stringResource(R.string.client_today) else stringResource(R.string.client_days_ago, days.toInt())
    return stringResource(R.string.client_unpaid_since, ago, formatShortDate(date))
}

/** A client: their initials, the name with how long the oldest unpaid service has waited, and what they owe. */
@Composable
internal fun ClientRow(client: Contact, today: LocalDate, onClick: () -> Unit) {
    val name = if (client.archivedAt != null) stringResource(R.string.client_archived, client.name) else client.name
    val hint = unpaidHint(client, today)
    val owed = balances(client)
    val owing = client.openBalances.isNotEmpty()
    ListRow(
        title = name,
        subtitle = hint,
        leading = { Avatar(client.name) },
        trailing = if (owing) {
            {
                Column(horizontalAlignment = Alignment.End) {
                    owed.lines.forEach { Text(it, style = MaterialTheme.typography.titleMedium.tabular(), maxLines = 1, softWrap = false) }
                }
            }
        } else {
            null
        },
        onClick = onClick,
        described = if (LocalPrivacy.current) listOf(name, owed.spoken, hint).joinToString(", ") else null,
    )
}

/** What a client owes as shown and as read aloud: each currency's balance, then its value at today's rates. */
internal class OwedText(val lines: List<String>, val note: String?, val spoken: String)

/** What a client owes: each currency's balance, then (with a foreign currency) its value in dollars at today's rates. */
@Composable
internal fun balances(client: Contact): OwedText {
    val none = client.openBalances.isEmpty()
    val amounts = if (none) listOf(money(0, "USD")) else client.openBalances.map { money(it.amount, it.currency) }
    val foreign = client.openBalances.any { it.currency != "USD" }
    val total = money(client.openBalance.amount, client.openBalance.currency)
    val note = if (!foreign) null else if (client.unconvertedCurrencies.isNotEmpty()) {
        stringResource(R.string.client_balance_note_missing, total.text, client.unconvertedCurrencies.joinToString(", "))
    } else {
        stringResource(R.string.client_balance_note, total.text)
    }
    val spokenNote = if (!foreign) null else if (client.unconvertedCurrencies.isNotEmpty()) {
        stringResource(R.string.client_balance_note_missing, total.spoken, client.unconvertedCurrencies.joinToString(", "))
    } else {
        stringResource(R.string.client_balance_note, total.spoken)
    }
    return OwedText(amounts.map { it.text }, note, (amounts.map { it.spoken } + listOfNotNull(spokenNote)).joinToString(", "))
}

@Composable
internal fun Balances(owed: OwedText) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        owed.lines.forEach { Text(it, style = MaterialTheme.typography.displaySmall.tabular(), maxLines = 1, softWrap = false) }
        owed.note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

/** Which of a client's two lists shows under the unpaid services. */
enum class ClientTab { Paid, History }

/** What one client's screen shows and does, as plain data. */
class ClientActions(
    val onBack: () -> Unit,
    val onTab: (ClientTab) -> Unit,
    val onMoreServices: () -> Unit,
    val onMoreHistory: () -> Unit,
    val onTogglePayments: (String) -> Unit,
    val onRetryClient: () -> Unit,
    val onRetryServices: () -> Unit,
    val onRetryHistory: () -> Unit,
    val onRetryPayments: (String) -> Unit,
)

/**
 * One client (ADR 0046), read-only: a top bar with their name, a balance card (what they owe, what is overdue, how
 * to reach them), the unpaid services pinned with Overdue marked, then Paid and History as a segmented control
 * (history is batched). Logging services and receiving payments stay on the web.
 */
@Composable
internal fun ClientContent(
    client: Online<Contact>,
    services: Online<Paged<Service>>,
    history: Online<Paged<HistoryEvent>>,
    payments: Map<String, Online<List<ServicePayment>>>,
    today: String,
    tab: ClientTab,
    actions: ClientActions,
    modifier: Modifier = Modifier,
) {
    Column(modifier) {
        val name = (client as? Online.Ready)?.value?.let { if (it.archivedAt != null) stringResource(R.string.client_archived, it.name) else it.name }
        TopBar(name ?: stringResource(R.string.clients_title), onBack = actions.onBack)
        LazyColumn(contentPadding = PaddingValues(top = CardGap, bottom = ListBottomSpace), verticalArrangement = Arrangement.spacedBy(CardGap)) {
            val loadedServices = (services as? Online.Ready)?.value?.items.orEmpty()
            when (client) {
                Online.Loading -> Unit
                Online.Offline -> item { RetryNote(stringResource(R.string.clients_offline), actions.onRetryClient) }
                Online.Failed -> item { RetryNote(stringResource(R.string.client_failed), actions.onRetryClient) }
                is Online.Ready -> item { BalanceCard(client.value, overdueSummary(loadedServices, today)) }
            }
            val split = splitServices(loadedServices, today)
            val servicesState = services as? Online.Ready
            if (split.unpaid.isNotEmpty()) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        SectionLabel(stringResource(R.string.client_unpaid_heading, countLabel(split.unpaid.size, servicesState?.value?.hasMore == true)))
                        GroupedListCard { split.unpaid.forEach { service -> row { ServiceRow(service, today, payments[service.id], { actions.onTogglePayments(service.id) }, { actions.onRetryPayments(service.id) }) } } }
                    }
                }
            }
            item {
                val paidCount = servicesState?.let { countLabel(split.paid.size, it.value.hasMore) }
                val eventCount = (history as? Online.Ready)?.value?.let { countLabel(it.items.size, it.hasMore) }
                SegmentedControl(
                    listOf(
                        paidCount?.let { stringResource(R.string.client_tab_paid, it) } ?: stringResource(R.string.service_paid),
                        eventCount?.let { stringResource(R.string.client_tab_history, it) } ?: stringResource(R.string.history_title),
                    ),
                    tab.ordinal,
                    { actions.onTab(ClientTab.entries[it]) },
                    Modifier.padding(horizontal = ScreenMargin),
                )
            }
            when (tab) {
                ClientTab.Paid -> paidItems(services, split.paid, payments, today, actions)
                ClientTab.History -> historyItems(history, actions)
            }
        }
    }
}

private fun LazyListScope.paidItems(services: Online<Paged<Service>>, paid: List<Service>, payments: Map<String, Online<List<ServicePayment>>>, today: String, actions: ClientActions) {
    when (services) {
        Online.Loading -> item { LedgerCard { Muted(stringResource(R.string.services_loading)) } }
        Online.Offline -> item { RetryNote(stringResource(R.string.clients_offline), actions.onRetryServices) }
        Online.Failed -> item { RetryNote(stringResource(R.string.services_failed), actions.onRetryServices) }
        is Online.Ready -> {
            val everything = services.value.items
            if (everything.isEmpty()) item { EmptyState(stringResource(R.string.services_empty)) }
            if (paid.isNotEmpty()) {
                item { GroupedListCard { paid.forEach { service -> row { ServiceRow(service, today, payments[service.id], { actions.onTogglePayments(service.id) }, { actions.onRetryPayments(service.id) }) } } } }
            }
            if (services.value.hasMore) {
                item { LoadMore(stringResource(R.string.load_more_services), services.value.loadingMore, services.value.moreFailed, actions.onMoreServices) }
            }
        }
    }
}

private fun LazyListScope.historyItems(history: Online<Paged<HistoryEvent>>, actions: ClientActions) {
    when (history) {
        Online.Loading -> item { LedgerCard { Muted(stringResource(R.string.history_loading)) } }
        Online.Offline -> item { RetryNote(stringResource(R.string.clients_offline), actions.onRetryHistory) }
        Online.Failed -> item { RetryNote(stringResource(R.string.history_failed), actions.onRetryHistory) }
        is Online.Ready -> {
            val lines = batchHistory(history.value.items)
            if (lines.isNotEmpty()) item { GroupedListCard { lines.forEach { line -> row { HistoryLineRow(line) } } } }
            if (history.value.hasMore) {
                item { LoadMore(stringResource(R.string.load_more_history), history.value.loadingMore, history.value.moreFailed, actions.onMoreHistory) }
            }
        }
    }
}

/**
 * What they owe (a figure per currency, with its value at today's rates when there is a foreign one), a red line
 * when a service is overdue (how many, and the earliest due date), and how to reach them.
 */
@Composable
private fun BalanceCard(client: Contact, overdue: Pair<Int, String>?) {
    val owed = balances(client)
    val label = stringResource(R.string.client_open_balance)
    val overdueLine = overdue?.let { (count, due) -> pluralStringResource(R.plurals.client_overdue_line, count, count, formatShortDate(due)) }
    val contact = listOfNotNull(client.phone, client.email, client.note)
    LedgerCard(padding = PaddingValues(16.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            Column(
                verticalArrangement = Arrangement.spacedBy(4.dp),
                modifier = if (LocalPrivacy.current) Modifier.clearAndSetSemantics { contentDescription = "$label ${owed.spoken}" } else Modifier,
            ) {
                Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Balances(owed)
            }
            if (overdueLine != null) Text(overdueLine, style = MaterialTheme.typography.bodySmall, color = LocalPalette.current.danger)
            contact.forEach { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

/** The date of a service as a hint shows it: the day, and the time when it has one. */
internal fun whenOf(service: Service): String = formatEntryDate(service.serviceDate) + (service.serviceTime?.let { " · ${formatServiceTime(it)}" } ?: "")
