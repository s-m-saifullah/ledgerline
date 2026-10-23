package app.ledgerline.android.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.overlay.AttentionItem
import app.ledgerline.android.overlay.AttentionReason
import app.ledgerline.android.ui.privacy.money

/** Sign out with changes the server does not have: send them first, or delete them on purpose. */
@Composable
internal fun SignOutQuestion(waiting: Int, viewModel: SignedInViewModel) {
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
internal fun AttentionScreen(viewModel: SignedInViewModel, onBack: () -> Unit, onFix: (String) -> Unit) {
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
            items(items, key = { it.id }) { item ->
                AttentionRow(item, onFix = onFix, onDiscard = viewModel::discard, onKeepMine = viewModel::keepMine, onKeepTheirs = viewModel::keepTheirs)
            }
        }
    }
}

@Composable
internal fun AttentionRow(
    item: AttentionItem,
    onFix: (String) -> Unit,
    onDiscard: (String) -> Unit,
    onKeepMine: (String) -> Unit,
    onKeepTheirs: (String) -> Unit,
) {
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
    val amount = if (item.amount != null && item.currency != null) money(item.amount, item.currency) else null
    val reason = when (item.reason) {
        AttentionReason.ChangedElsewhere -> stringResource(R.string.attention_changed_elsewhere)
        AttentionReason.DeletedElsewhere -> stringResource(R.string.attention_deleted_elsewhere)
        AttentionReason.Rejected -> stringResource(R.string.attention_rejected, item.detail ?: "")
    }
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            listOfNotNull(what, item.payee, amount?.text).joinToString(" · "),
            style = MaterialTheme.typography.titleMedium.tabular(),
            modifier = Modifier.semantics { contentDescription = listOfNotNull(what, item.payee, amount?.spoken).joinToString(", ") },
        )
        Text(reason, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (item.reason == AttentionReason.Rejected) {
                if (!item.type.endsWith(".delete")) {
                    OutlinedButton(onClick = { onFix(item.id) }, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(stringResource(R.string.attention_edit))
                    }
                }
                OutlinedButton(onClick = { onDiscard(item.id) }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.attention_discard))
                }
            } else {
                if (item.canKeepMine) {
                    OutlinedButton(onClick = { onKeepMine(item.id) }, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(stringResource(R.string.attention_keep_mine))
                    }
                }
                OutlinedButton(onClick = { onKeepTheirs(item.id) }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.attention_keep_theirs))
                }
            }
        }
    }
    HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))
}
