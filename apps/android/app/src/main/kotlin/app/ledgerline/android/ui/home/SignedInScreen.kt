package app.ledgerline.android.ui.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.activity.compose.BackHandler
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.FabPosition
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import app.ledgerline.android.R
import app.ledgerline.android.mirror.AccountBalance
import app.ledgerline.android.mirror.EntryLine
import app.ledgerline.android.ui.editor.EditorScreen
import app.ledgerline.android.ui.editor.EditorTarget
import app.ledgerline.android.ui.format.formatEntryDate
import java.util.UUID
import app.ledgerline.android.ui.more.MoreScreen
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.android.ui.format.formatUpdated

/** Tabular figures, so amounts line up. */
internal fun TextStyle.tabular() = copy(fontFeatureSettings = "tnum")

/** The bottom bar, as on the web: Home, Transactions, Budgets, Insights and More (ADR 0043, slice 5). */
enum class Tab(val title: Int, val icon: Int) {
    Home(R.string.home_title, R.drawable.ic_home),
    Transactions(R.string.entries_title, R.drawable.ic_entries),
    Budgets(R.string.budgets_title, R.drawable.ic_budgets),
    Insights(R.string.insights_title, R.drawable.ic_insights),
    More(R.string.more_title, R.drawable.ic_more),
}

/** Room under every list for the centred Add button, so it never covers the last row. */
private val ListBottomSpace = 96.dp

/** The signed-in app: the mirrored accounts and entries, entries made offline, and More. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SignedInScreen(viewModel: SignedInViewModel = hiltViewModel()) {
    var tab by rememberSaveable { mutableStateOf(Tab.Home) }
    var showAttention by rememberSaveable { mutableStateOf(false) }
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    val line by viewModel.syncLine.collectAsState()
    val confirmSignOut by viewModel.confirmSignOut.collectAsState()
    confirmSignOut?.let { waiting -> SignOutQuestion(waiting, viewModel) }
    editing?.let { opened ->
        // "<session>|<target>": every opening of the editor gets its own session.
        val (session, target) = opened.split("|", limit = 2)
        EditorScreen(EditorTarget.decode(target), session, onClose = { editing = null })
        return
    }
    val edit = { target: EditorTarget -> editing = "${UUID.randomUUID()}|${target.encode()}" }
    if (showAttention) {
        BackHandler { showAttention = false }
        AttentionScreen(viewModel, onBack = { showAttention = false }, onFix = { edit(EditorTarget.Fix(it)) })
        return
    }
    val openAttention = { showAttention = true }
    Scaffold(
        topBar = { TopAppBar(title = { Text(stringResource(tab.title)) }) },
        floatingActionButton = {
            FloatingActionButton(onClick = { edit(EditorTarget.New()) }) {
                Icon(painterResource(R.drawable.ic_add), contentDescription = stringResource(R.string.add))
            }
        },
        floatingActionButtonPosition = FabPosition.Center,
        bottomBar = {
            NavigationBar {
                Tab.entries.forEach { item ->
                    NavigationBarItem(
                        selected = tab == item,
                        onClick = { tab = item },
                        icon = { Icon(painterResource(item.icon), contentDescription = null) },
                        label = { Text(stringResource(item.title), maxLines = 1) },
                    )
                }
            }
        },
    ) { padding ->
        val inside = Modifier.fillMaxSize().padding(padding)
        when (tab) {
            Tab.Home, Tab.Transactions -> PullToRefreshBox(isRefreshing = line.running, onRefresh = viewModel::refresh, modifier = inside) {
                val openEntry = { line: EntryLine ->
                    edit(
                        if (line.kind == "transfer" && line.transferId != null) {
                            EditorTarget.Transfer(line.transferId)
                        } else {
                            EditorTarget.Entry(line.id)
                        },
                    )
                }
                if (tab == Tab.Home) AccountsList(viewModel, line, openAttention) else EntriesList(viewModel, line, openAttention, openEntry)
            }
            Tab.Budgets -> Box(inside) { Later(R.string.later_budgets) }
            Tab.Insights -> Box(inside) { Later(R.string.later_insights) }
            Tab.More -> Box(inside) { MoreScreen(viewModel, openAttention, ListBottomSpace) }
        }
    }
}

/** A screen that arrives in a later part of slice 5. */
@Composable
private fun Later(text: Int) {
    Text(
        stringResource(text),
        modifier = Modifier.padding(16.dp),
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun SyncStatus(line: SyncLine, onRetry: () -> Unit) {
    val updated = line.updatedAt?.let { stringResource(R.string.sync_updated, formatUpdated(it)) }
    val text = when {
        line.running -> stringResource(R.string.sync_running)
        line.problem == SyncProblem.Offline && updated != null -> stringResource(R.string.sync_offline_saved, updated)
        line.problem == SyncProblem.Offline -> stringResource(R.string.sync_offline)
        line.problem == SyncProblem.Failed -> stringResource(R.string.sync_failed)
        else -> updated
    }
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).heightIn(min = 48.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            text.orEmpty(),
            style = MaterialTheme.typography.bodySmall,
            color = if (line.problem == SyncProblem.Failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        if (line.problem != null && !line.running) {
            TextButton(onClick = onRetry, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.try_again)) }
        }
    }
}

/** The top of each list: the sync line, the unsent count and the way to changes that need the owner. */
@Composable
private fun ListHeader(viewModel: SignedInViewModel, line: SyncLine, openAttention: () -> Unit) {
    val unsent by viewModel.unsent.collectAsState()
    val attention by viewModel.attention.collectAsState()
    SyncStatus(line, viewModel::refresh)
    if (unsent > 0) {
        Text(
            pluralStringResource(R.plurals.unsent_count, unsent, unsent),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
    }
    if (attention.isNotEmpty()) {
        OutlinedButton(
            onClick = openAttention,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).heightIn(min = 48.dp),
        ) { Text(pluralStringResource(R.plurals.attention_banner, attention.size, attention.size)) }
    }
}

@Composable
private fun Waiting() {
    Text(
        stringResource(R.string.mirror_waiting),
        modifier = Modifier.padding(16.dp),
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun AccountsList(viewModel: SignedInViewModel, line: SyncLine, openAttention: () -> Unit) {
    val state by viewModel.accounts.collectAsState()
    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = ListBottomSpace)) {
        item { ListHeader(viewModel, line, openAttention) }
        when (val current = state) {
            Mirrored.Waiting -> item { Waiting() }
            is Mirrored.Ready -> {
                val (active, archived) = current.items.partition { it.archivedAt == null }
                item { SectionHeading(R.string.accounts_title) }
                if (current.items.isEmpty()) {
                    item { Text(stringResource(R.string.accounts_empty), modifier = Modifier.padding(16.dp)) }
                }
                items(active, key = { it.id }) { AccountRow(it) }
                if (archived.isNotEmpty()) {
                    item { SectionHeading(R.string.accounts_archived) }
                    items(archived, key = { it.id }) { AccountRow(it) }
                }
            }
        }
    }
}

@Composable
private fun SectionHeading(text: Int) {
    Text(
        stringResource(text),
        style = MaterialTheme.typography.titleSmall,
        modifier = Modifier.padding(start = 16.dp, top = 24.dp, bottom = 8.dp).semantics { heading() },
    )
}

@Composable
internal fun AccountRow(account: AccountBalance) {
    val balance = money(account.balance, account.currency)
    val pending = if (account.pending > 0) pluralStringResource(R.plurals.accounts_pending_plural, account.pending, account.pending) else null
    val described = listOfNotNull(account.name, balance.spoken, pending).joinToString(", ")
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .clearAndSetSemantics { contentDescription = described },
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(account.name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(balance.text, style = MaterialTheme.typography.titleLarge.tabular(), modifier = Modifier.padding(start = 12.dp))
        }
        if (pending != null) {
            Text(pending, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))
}

@Composable
private fun EntriesList(viewModel: SignedInViewModel, line: SyncLine, openAttention: () -> Unit, openEntry: (EntryLine) -> Unit) {
    val state by viewModel.entries.collectAsState()
    val canShowMore by viewModel.canShowMore.collectAsState()
    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = ListBottomSpace)) {
        item { ListHeader(viewModel, line, openAttention) }
        when (val current = state) {
            Mirrored.Waiting -> item { Waiting() }
            is Mirrored.Ready -> {
                if (current.items.isEmpty()) {
                    item { Text(stringResource(R.string.entries_empty), modifier = Modifier.padding(16.dp)) }
                }
                items(current.items, key = { it.line.id }) { EntryRow(it.line, it.unsent) { openEntry(it.line) } }
                if (canShowMore) {
                    item {
                        TextButton(
                            onClick = viewModel::showMoreEntries,
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).heightIn(min = 48.dp),
                        ) { Text(stringResource(R.string.entries_show_more)) }
                    }
                }
            }
        }
    }
}

@Composable
internal fun EntryRow(entry: EntryLine, unsent: Boolean, onOpen: () -> Unit) {
    val title = entry.payee?.takeIf { it.isNotBlank() }
        ?: when {
            entry.kind == "transfer" -> stringResource(R.string.entry_transfer)
            entry.isSplit -> stringResource(R.string.entry_split)
            else -> entry.categoryName ?: stringResource(R.string.entry_untitled)
        }
    val category = when {
        entry.isSplit -> stringResource(R.string.entry_split)
        entry.kind == "transfer" -> null
        else -> entry.categoryName
    }
    val details = listOfNotNull(formatEntryDate(entry.date), entry.accountName, category.takeIf { it != title }, entry.tagNames)
        .joinToString(" · ")
    val amount = money(entry.amount, entry.currency)
    val pending = if (entry.status == "pending") stringResource(R.string.entry_pending) else null
    val notSent = if (unsent) stringResource(R.string.entry_not_sent) else null
    val described = listOfNotNull(title, amount.spoken, pending, notSent, details).joinToString(", ")
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .heightIn(min = 64.dp)
            .padding(horizontal = 16.dp, vertical = 10.dp)
            .clearAndSetSemantics { contentDescription = described },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                details,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Column(horizontalAlignment = Alignment.End, modifier = Modifier.padding(start = 12.dp)) {
            Text(amount.text, style = MaterialTheme.typography.titleMedium.tabular())
            if (pending != null) {
                Text(pending, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (notSent != null) {
                Text(notSent, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
            }
        }
    }
    HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))
}
