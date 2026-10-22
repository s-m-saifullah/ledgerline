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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.runtime.mutableIntStateOf
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
import app.ledgerline.android.overlay.AttentionItem
import app.ledgerline.android.overlay.AttentionReason
import app.ledgerline.android.ui.editor.EditorScreen
import app.ledgerline.android.ui.editor.EditorTarget
import app.ledgerline.android.ui.format.formatEntryDate
import java.util.UUID
import app.ledgerline.android.ui.format.formatMoney
import app.ledgerline.android.ui.format.formatUpdated

/** Tabular figures, so amounts line up. */
private fun TextStyle.tabular() = copy(fontFeatureSettings = "tnum")

/** The signed-in app for slice 3: the mirrored accounts and entries, read-only (ADR 0043). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SignedInScreen(viewModel: SignedInViewModel = hiltViewModel()) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var menuOpen by rememberSaveable { mutableStateOf(false) }
    var showAttention by rememberSaveable { mutableStateOf(false) }
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    val line by viewModel.syncLine.collectAsState()
    val signingOut by viewModel.signingOut.collectAsState()
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
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(if (tab == 0) R.string.accounts_title else R.string.entries_title)) },
                actions = {
                    Box {
                        IconButton(onClick = { menuOpen = true }) {
                            Icon(painterResource(R.drawable.ic_more), contentDescription = stringResource(R.string.menu_more))
                        }
                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.refresh_everything)) },
                                onClick = {
                                    menuOpen = false
                                    viewModel.refreshEverything()
                                },
                            )
                            if (viewModel.canLock) {
                                DropdownMenuItem(
                                    text = { Text(stringResource(R.string.lock_now)) },
                                    onClick = {
                                        menuOpen = false
                                        viewModel.lock()
                                    },
                                )
                            }
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.sign_out)) },
                                enabled = !signingOut,
                                onClick = {
                                    menuOpen = false
                                    viewModel.signOut()
                                },
                            )
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { edit(EditorTarget.New()) }) {
                Icon(painterResource(R.drawable.ic_add), contentDescription = stringResource(R.string.add))
            }
        },
        floatingActionButtonPosition = FabPosition.Center,
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = tab == 0,
                    onClick = { tab = 0 },
                    icon = { Icon(painterResource(R.drawable.ic_accounts), contentDescription = null) },
                    label = { Text(stringResource(R.string.accounts_title)) },
                )
                NavigationBarItem(
                    selected = tab == 1,
                    onClick = { tab = 1 },
                    icon = { Icon(painterResource(R.drawable.ic_entries), contentDescription = null) },
                    label = { Text(stringResource(R.string.entries_title)) },
                )
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = line.running,
            onRefresh = viewModel::refresh,
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            val openAttention = { showAttention = true }
            val openEntry = { line: EntryLine ->
                edit(
                    if (line.kind == "transfer" && line.transferId != null) {
                        EditorTarget.Transfer(line.transferId)
                    } else {
                        EditorTarget.Entry(line.id)
                    },
                )
            }
            if (tab == 0) AccountsList(viewModel, line, openAttention) else EntriesList(viewModel, line, openAttention, openEntry)
        }
    }
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
    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item { ListHeader(viewModel, line, openAttention) }
        when (val current = state) {
            Mirrored.Waiting -> item { Waiting() }
            is Mirrored.Ready -> {
                val (active, archived) = current.items.partition { it.archivedAt == null }
                if (current.items.isEmpty()) {
                    item { Text(stringResource(R.string.accounts_empty), modifier = Modifier.padding(16.dp)) }
                }
                items(active, key = { it.id }) { AccountRow(it) }
                if (archived.isNotEmpty()) {
                    item {
                        Text(
                            stringResource(R.string.accounts_archived),
                            style = MaterialTheme.typography.titleSmall,
                            modifier = Modifier.padding(start = 16.dp, top = 24.dp, bottom = 8.dp).semantics { heading() },
                        )
                    }
                    items(archived, key = { it.id }) { AccountRow(it) }
                }
            }
        }
    }
}

@Composable
private fun AccountRow(account: AccountBalance) {
    val balance = formatMoney(account.balance, account.currency)
    val pending = if (account.pending > 0) pluralStringResource(R.plurals.accounts_pending_plural, account.pending, account.pending) else null
    val described = listOfNotNull(account.name, balance, pending).joinToString(", ")
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .clearAndSetSemantics { contentDescription = described },
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(account.name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(balance, style = MaterialTheme.typography.titleLarge.tabular(), modifier = Modifier.padding(start = 12.dp))
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
    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
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
private fun EntryRow(entry: EntryLine, unsent: Boolean, onOpen: () -> Unit) {
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
    val amount = formatMoney(entry.amount, entry.currency)
    val pending = if (entry.status == "pending") stringResource(R.string.entry_pending) else null
    val notSent = if (unsent) stringResource(R.string.entry_not_sent) else null
    val described = listOfNotNull(title, amount, pending, notSent, details).joinToString(", ")
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
            Text(amount, style = MaterialTheme.typography.titleMedium.tabular())
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

/** Sign out with changes the server does not have: send them first, or delete them on purpose. */
@Composable
private fun SignOutQuestion(waiting: Int, viewModel: SignedInViewModel) {
    AlertDialog(
        onDismissRequest = viewModel::cancelSignOut,
        title = { Text(pluralStringResource(R.plurals.signout_unsent_title, waiting, waiting)) },
        text = { Text(stringResource(R.string.signout_unsent_body)) },
        confirmButton = {
            TextButton(onClick = viewModel::sendBeforeSigningOut, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(R.string.signout_send_now))
            }
        },
        dismissButton = {
            Column(horizontalAlignment = Alignment.End) {
                TextButton(onClick = viewModel::cancelSignOut, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.cancel))
                }
                TextButton(onClick = viewModel::signOutDeletingUnsent, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(
                        pluralStringResource(R.plurals.signout_delete_unsent, waiting, waiting),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AttentionScreen(viewModel: SignedInViewModel, onBack: () -> Unit, onFix: (String) -> Unit) {
    val items by viewModel.attention.collectAsState()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.attention_title)) },
                navigationIcon = {
                    TextButton(onClick = onBack, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.back)) }
                },
            )
        },
    ) { padding ->
        LazyColumn(modifier = Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(bottom = 24.dp)) {
            if (items.isEmpty()) {
                item { Text(stringResource(R.string.attention_empty), modifier = Modifier.padding(16.dp)) }
            }
            items(items, key = { it.id }) { item -> AttentionRow(item, viewModel, onFix) }
        }
    }
}

@Composable
private fun AttentionRow(item: AttentionItem, viewModel: SignedInViewModel, onFix: (String) -> Unit) {
    val what = stringResource(
        when (item.type) {
            "transaction.create" -> R.string.change_new_entry
            "transaction.update" -> R.string.change_edit_entry
            "transaction.delete" -> R.string.change_delete_entry
            "transfer.create" -> R.string.change_new_transfer
            "transfer.update" -> R.string.change_edit_transfer
            else -> R.string.change_delete_transfer
        },
    )
    val amount = if (item.amount != null && item.currency != null) formatMoney(item.amount, item.currency) else null
    val reason = when (item.reason) {
        AttentionReason.ChangedElsewhere -> stringResource(R.string.attention_changed_elsewhere)
        AttentionReason.DeletedElsewhere -> stringResource(R.string.attention_deleted_elsewhere)
        AttentionReason.Rejected -> stringResource(R.string.attention_rejected, item.detail ?: "")
    }
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(listOfNotNull(what, item.payee, amount).joinToString(" · "), style = MaterialTheme.typography.titleMedium.tabular())
        Text(reason, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (item.reason == AttentionReason.Rejected) {
                if (!item.type.endsWith(".delete")) {
                    OutlinedButton(onClick = { onFix(item.id) }, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(stringResource(R.string.attention_edit))
                    }
                }
                OutlinedButton(onClick = { viewModel.discard(item.id) }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.attention_discard))
                }
            } else {
                if (item.canKeepMine) {
                    OutlinedButton(onClick = { viewModel.keepMine(item.id) }, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(stringResource(R.string.attention_keep_mine))
                    }
                }
                OutlinedButton(onClick = { viewModel.keepTheirs(item.id) }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.attention_keep_theirs))
                }
            }
        }
    }
    HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))
}
