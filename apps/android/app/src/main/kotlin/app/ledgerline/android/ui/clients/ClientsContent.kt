package app.ledgerline.android.ui.clients

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.Paged
import app.ledgerline.android.ui.design.AmountRow
import app.ledgerline.android.ui.design.BackLink
import app.ledgerline.android.ui.design.ChoiceField
import app.ledgerline.android.ui.design.LedgerCard
import app.ledgerline.android.ui.design.LoadMore
import app.ledgerline.android.ui.design.MutedLine
import app.ledgerline.android.ui.design.PageHeader
import app.ledgerline.android.ui.design.RetryNote
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SearchField
import app.ledgerline.android.ui.design.tabular
import app.ledgerline.android.ui.home.ListBottomSpace
import app.ledgerline.android.ui.home.Muted
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.api.Contact
import app.ledgerline.api.HistoryEvent
import app.ledgerline.api.Service
import app.ledgerline.api.ServicePayment

/** What the clients list's controls show and do, as plain data. */
class ClientsListActions(
    val onBack: () -> Unit,
    val onSearch: (String) -> Unit,
    val onFilter: (String) -> Unit,
    val onOpen: (String) -> Unit,
    val onMore: () -> Unit,
    val onRetry: () -> Unit,
)

/**
 * Clients as on the web (ADR 0045), read-only: the header, a search and a status, then a card per client with
 * what they owe and their oldest unpaid service. Adding a client stays on the web (ADR 0043).
 */
@Composable
internal fun ClientsListContent(
    text: String,
    status: String,
    state: Online<Paged<Contact>>,
    actions: ClientsListActions,
    modifier: Modifier = Modifier,
) {
    LazyColumn(modifier = modifier, contentPadding = PaddingValues(bottom = ListBottomSpace), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            BackLink(stringResource(R.string.back_more), actions.onBack)
            PageHeader(
                stringResource(R.string.clients_title),
                eyebrow = stringResource(R.string.eyebrow_owed),
                subtitle = stringResource(R.string.clients_subtitle),
            )
        }
        item { SearchField(stringResource(R.string.clients_search), text, actions.onSearch) }
        item {
            ChoiceField(
                stringResource(R.string.clients_status),
                listOf(
                    "all" to stringResource(R.string.clients_all),
                    "active" to stringResource(R.string.clients_active),
                    "archived" to stringResource(R.string.clients_archived),
                ),
                status,
                actions.onFilter,
                modifier = Modifier.padding(horizontal = ScreenMargin),
            )
        }
        when (state) {
            Online.Loading -> item { LedgerCard { Muted(stringResource(R.string.clients_loading)) } }
            Online.Offline -> item { RetryNote(stringResource(R.string.clients_offline), actions.onRetry) }
            Online.Failed -> item { RetryNote(stringResource(R.string.clients_failed), actions.onRetry) }
            is Online.Ready -> {
                val paged = state.value
                if (paged.items.isEmpty()) {
                    item {
                        LedgerCard {
                            Text(
                                stringResource(if (text.isNotEmpty()) R.string.clients_empty_none else R.string.clients_empty_title),
                                style = MaterialTheme.typography.titleLarge,
                                modifier = Modifier.semantics { heading() },
                            )
                            Muted(stringResource(R.string.clients_empty_body))
                        }
                    }
                }
                items(paged.items, key = { it.id }) { ClientCard(it, onClick = { actions.onOpen(it.id) }) }
                if (paged.hasMore) {
                    item { LoadMore(stringResource(R.string.load_more_clients), paged.loadingMore, paged.moreFailed, actions.onMore) }
                }
            }
        }
    }
}

/** `.client-card`: the name, what they owe, and the oldest unpaid service. */
@Composable
internal fun ClientCard(client: Contact, onClick: () -> Unit) {
    val name = if (client.archivedAt != null) stringResource(R.string.client_archived, client.name) else client.name
    val oldest = client.oldestOpenServiceDate?.let { stringResource(R.string.client_oldest_unpaid, it) } ?: stringResource(R.string.client_no_open)
    val owed = balances(client)
    LedgerCard(
        modifier = Modifier
            .clickable(onClick = onClick)
            .clearAndSetSemantics { contentDescription = listOf(name, owed.spoken, oldest).joinToString(", ") },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(name, style = MaterialTheme.typography.titleMedium)
            Balances(owed)
            Text(oldest, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
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

/** What one client's screen shows and does, as plain data. */
class ClientActions(
    val onBack: () -> Unit,
    val onMoreServices: () -> Unit,
    val onMoreHistory: () -> Unit,
    val onTogglePayments: (String) -> Unit,
    val onRetryClient: () -> Unit,
    val onRetryServices: () -> Unit,
    val onRetryHistory: () -> Unit,
    val onRetryPayments: (String) -> Unit,
)

/**
 * One client as on the web, read-only: their details and what they owe, their services (each with its payments,
 * opened on request) and what happened to them. Logging services and payments stays on the web.
 */
@Composable
internal fun ClientContent(
    client: Online<Contact>,
    services: Online<Paged<Service>>,
    history: Online<Paged<HistoryEvent>>,
    payments: Map<String, Online<List<ServicePayment>>>,
    today: String,
    actions: ClientActions,
    modifier: Modifier = Modifier,
) {
    LazyColumn(modifier = modifier, contentPadding = PaddingValues(bottom = ListBottomSpace), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            BackLink(stringResource(R.string.clients_all), actions.onBack)
            PageHeader(
                stringResource(R.string.clients_title),
                eyebrow = stringResource(R.string.eyebrow_owed),
                subtitle = stringResource(R.string.clients_subtitle),
            )
        }
        when (client) {
            Online.Loading -> Unit
            Online.Offline -> item { RetryNote(stringResource(R.string.clients_offline), actions.onRetryClient) }
            Online.Failed -> item { RetryNote(stringResource(R.string.client_failed), actions.onRetryClient) }
            is Online.Ready -> item { ClientDetails(client.value) }
        }
        item { SectionHeading(stringResource(R.string.services_title)) }
        pagedSection(
            services,
            loading = R.string.services_loading,
            offline = R.string.clients_offline,
            failed = R.string.services_failed,
            empty = R.string.services_empty,
            more = R.string.load_more_services,
            onMore = actions.onMoreServices,
            onRetry = actions.onRetryServices,
            card = { rows ->
                LedgerCard(padding = PaddingValues(horizontal = 20.dp, vertical = 4.dp)) {
                    rows.forEachIndexed { index, service ->
                        ServiceRow(
                            service,
                            divider = index > 0,
                            today = today,
                            payments = payments[service.id],
                            onTogglePayments = { actions.onTogglePayments(service.id) },
                            onRetryPayments = { actions.onRetryPayments(service.id) },
                        )
                    }
                }
            },
        )
        item { SectionHeading(stringResource(R.string.history_title)) }
        pagedSection(
            history,
            loading = R.string.history_loading,
            offline = R.string.clients_offline,
            failed = R.string.history_failed,
            empty = null,
            more = R.string.load_more_history,
            onMore = actions.onMoreHistory,
            onRetry = actions.onRetryHistory,
            card = { rows ->
                LedgerCard(padding = PaddingValues(horizontal = 20.dp, vertical = 4.dp)) {
                    rows.forEachIndexed { index, event -> HistoryRow(event, divider = index > 0) }
                }
            },
        )
    }
}

private fun <T> LazyListScope.pagedSection(
    state: Online<Paged<T>>,
    loading: Int,
    offline: Int,
    failed: Int,
    empty: Int?,
    more: Int,
    onMore: () -> Unit,
    onRetry: () -> Unit,
    card: @Composable (List<T>) -> Unit,
) {
    when (state) {
        Online.Loading -> item { LedgerCard { Muted(stringResource(loading)) } }
        Online.Offline -> item { RetryNote(stringResource(offline), onRetry) }
        Online.Failed -> item { RetryNote(stringResource(failed), onRetry) }
        is Online.Ready -> {
            val paged = state.value
            if (paged.items.isEmpty() && empty != null) item { MutedLine(stringResource(empty)) }
            if (paged.items.isNotEmpty()) item { card(paged.items) }
            if (paged.hasMore) item { LoadMore(stringResource(more), paged.loadingMore, paged.moreFailed, onMore) }
        }
    }
}

@Composable
private fun SectionHeading(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleLarge,
        modifier = Modifier.padding(start = ScreenMargin, end = ScreenMargin, top = 12.dp).semantics { heading() },
    )
}

/** `.client-detail`: the name, what they owe, their oldest unpaid service and how to reach them. */
@Composable
private fun ClientDetails(client: Contact) {
    val owed = balances(client)
    val name = if (client.archivedAt != null) stringResource(R.string.client_archived, client.name) else client.name
    val balanceLabel = stringResource(R.string.client_open_balance)
    LedgerCard {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
            Text(name, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
            Column(
                verticalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier.clearAndSetSemantics { contentDescription = "$balanceLabel ${owed.spoken}" },
            ) {
                Text(stringResource(R.string.client_open_balance), style = MaterialTheme.typography.bodyMedium)
                Balances(owed)
            }
            client.oldestOpenServiceDate?.let { Muted(stringResource(R.string.client_oldest_service, it)) }
            listOfNotNull(client.phone, client.email, client.note).forEach { Text(it, style = MaterialTheme.typography.bodyLarge) }
        }
    }
}
