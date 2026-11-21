package app.ledgerline.android.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.overlay.AttentionItem
import app.ledgerline.android.overlay.AttentionReason
import app.ledgerline.android.ui.design.EmptyState
import app.ledgerline.android.ui.design.GroupedListCard
import app.ledgerline.android.ui.design.ListRow
import app.ledgerline.android.ui.design.Question
import app.ledgerline.android.ui.design.QuestionAction
import app.ledgerline.android.ui.design.SecondaryButton
import app.ledgerline.android.ui.design.TopBar
import app.ledgerline.android.ui.design.tabular
import app.ledgerline.android.ui.privacy.money
import androidx.compose.material3.MaterialTheme

/** Sign out with changes the server does not have: send them first, or delete them on purpose. */
@Composable
internal fun SignOutQuestion(waiting: Int, viewModel: SignedInViewModel) {
    Question(
        title = pluralStringResource(R.plurals.signout_unsent_title, waiting, waiting),
        confirm = stringResource(R.string.signout_send_now),
        onConfirm = viewModel::sendBeforeSigningOut,
        onDismiss = viewModel::cancelSignOut,
        extra = QuestionAction(pluralStringResource(R.plurals.signout_delete_unsent, waiting, waiting), viewModel::signOutDeletingUnsent, danger = true),
    ) { Text(stringResource(R.string.signout_unsent_body)) }
}

/** What the buttons of "Needs your attention" report. */
internal class AttentionActions(
    val onBack: () -> Unit,
    val onFix: (String) -> Unit,
    val onDiscard: (String) -> Unit,
    val onKeepMine: (String) -> Unit,
    val onKeepTheirs: (String) -> Unit,
)

@Composable
internal fun AttentionScreen(viewModel: SignedInViewModel, onBack: () -> Unit, onFix: (String) -> Unit) {
    val items by viewModel.attention.collectAsState()
    val actions = AttentionActions(onBack, onFix, viewModel::discard, viewModel::keepMine, viewModel::keepTheirs)
    AttentionContent(items, actions, Modifier.safeDrawingPadding())
}

/**
 * The changes that need the owner, as plain data (so a test and a screenshot can draw it): a bar with a back arrow, one grouped
 * card of changes (what it was, the payee and amount, why, and what can be done), or the shared empty state. Discard deletes a
 * change that exists nowhere else, so it asks first.
 */
@Composable
internal fun AttentionContent(items: List<AttentionItem>, actions: AttentionActions, modifier: Modifier = Modifier) {
    var discarding by rememberSaveable { mutableStateOf<String?>(null) }
    discarding?.let { id ->
        Question(
            title = stringResource(R.string.attention_discard_title),
            confirm = stringResource(R.string.attention_discard),
            onConfirm = { discarding = null; actions.onDiscard(id) },
            onDismiss = { discarding = null },
            danger = true,
        ) { Text(stringResource(R.string.attention_discard_body)) }
    }
    Column(modifier.fillMaxSize()) {
        TopBar(stringResource(R.string.attention_title), onBack = actions.onBack)
        if (items.isEmpty()) {
            EmptyState(stringResource(R.string.attention_empty))
        } else {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
                GroupedListCard {
                    items.forEach { item -> row { AttentionRow(item, actions) { discarding = it } } }
                }
            }
        }
    }
}

@Composable
internal fun AttentionRow(item: AttentionItem, actions: AttentionActions, onAskDiscard: (String) -> Unit) {
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
    ListRow(
        title = listOfNotNull(what, item.payee).joinToString(" · "),
        subtitle = reason,
        trailing = amount?.let { shown ->
            { Text(shown.text, style = MaterialTheme.typography.titleMedium.tabular(), modifier = Modifier.semantics { contentDescription = shown.spoken }) }
        },
        extra = {
            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (item.reason == AttentionReason.Rejected) {
                    if (!item.type.endsWith(".delete")) SecondaryButton(stringResource(R.string.attention_edit), { actions.onFix(item.id) }, Modifier.weight(1f))
                    SecondaryButton(stringResource(R.string.attention_discard), { onAskDiscard(item.id) }, Modifier.weight(1f), danger = true)
                } else {
                    if (item.canKeepMine) SecondaryButton(stringResource(R.string.attention_keep_mine), { actions.onKeepMine(item.id) }, Modifier.weight(1f))
                    SecondaryButton(stringResource(R.string.attention_keep_theirs), { actions.onKeepTheirs(item.id) }, Modifier.weight(1f))
                }
            }
        },
    )
}
