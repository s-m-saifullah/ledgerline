package app.ledgerline.android.ui.categories

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.mirror.CategoryRow
import app.ledgerline.android.ui.design.Avatar
import app.ledgerline.android.ui.design.CardGap
import app.ledgerline.android.ui.design.EmptyState
import app.ledgerline.android.ui.design.FilterChip
import app.ledgerline.android.ui.design.GroupedListCard
import app.ledgerline.android.ui.design.LinkButton
import app.ledgerline.android.ui.design.RowHeight
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SearchBox
import app.ledgerline.android.ui.design.SegmentedControl
import app.ledgerline.android.ui.design.TopBar
import app.ledgerline.android.ui.design.TouchTarget
import app.ledgerline.android.ui.home.Muted
import app.ledgerline.android.ui.theme.LocalPalette

/** What the Categories screen's buttons and fields do. */
class CategoriesActions(
    val onBack: () -> Unit,
    val setKind: (String) -> Unit,
    val setStatus: (CategoryStatus) -> Unit,
    val setSearch: (String) -> Unit,
    val add: () -> Unit,
    val edit: (CategoryRow) -> Unit,
    val askArchive: (CategoryRow) -> Unit,
    val unarchive: (CategoryRow) -> Unit,
    val changeForm: ((CategoryForm) -> CategoryForm) -> Unit,
    val save: () -> Unit,
    val closeForm: () -> Unit,
    val confirmArchive: () -> Unit,
    val dismissAsk: () -> Unit,
    val askDelete: (CategoryRow) -> Unit,
    val confirmDelete: () -> Unit,
    val dismissDeleteAsk: () -> Unit,
    val archiveInstead: () -> Unit,
    val openMenu: (CategoryRow) -> Unit,
    val closeMenu: () -> Unit,
    val addUnder: (CategoryRow) -> Unit,
    val toggleGroup: (String) -> Unit,
    val toggleAll: (List<String>) -> Unit,
)

/**
 * The Categories screen as plain data (ADR 0046): a fixed header (the top bar with Add category, Expense and Income with
 * their counts, the search, and the status chips while something is archived) above one accordion card. The Add and Edit
 * form and a row's actions are sheets; the archive and delete questions are dialogs. [items] is every category of the
 * ledger (the list rules need the whole tree); [groups] is null until the mirror has a ledger.
 */
@Composable
fun CategoriesContent(
    view: CategoriesView,
    groups: List<CategoryGroup>?,
    items: List<CategoryRow>,
    actions: CategoriesActions,
    bottomSpace: Dp,
    modifier: Modifier = Modifier,
) {
    view.ask?.let { ArchiveQuestion(it.category, actions) }
    view.deleteAsk?.let { DeleteQuestion(it, actions) }
    view.form?.let { form ->
        val editing = form.editing
        val hasSubcategories = editing != null && items.any { it.deletedAt == null && it.parentId == editing.id }
        CategoryFormSheet(form, parentChoices(items, form.kind, editing), hasSubcategories, view.saving, view.error, actions)
    }
    view.menu?.let { CategoryActionsSheet(it, items, actions) }
    val chips = showStatusChips(items, view.kind)
    val status = effectiveStatus(items, view.kind, view.status)
    val message = messageText(view)
    Column(modifier) {
        TopBar(
            stringResource(R.string.categories_title),
            onBack = actions.onBack,
            action = {
                if (groups != null) {
                    val add = stringResource(R.string.categories_add)
                    IconButton(onClick = actions.add, modifier = Modifier.size(TouchTarget).semantics { contentDescription = add }) {
                        Icon(painterResource(R.drawable.ic_add), contentDescription = null, tint = LocalPalette.current.accent)
                    }
                }
            },
        )
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            val labels = listOf(
                stringResource(R.string.category_kind_expense_count, mainCount(items, "expense")),
                stringResource(R.string.category_kind_income_count, mainCount(items, "income")),
            )
            SegmentedControl(
                labels,
                if (view.kind == "income") 1 else 0,
                { actions.setKind(if (it == 1) "income" else "expense") },
                Modifier.padding(horizontal = ScreenMargin),
            )
            SearchBox(stringResource(R.string.categories_search), view.search, actions.setSearch, Modifier.padding(horizontal = ScreenMargin))
            if (chips) {
                Row(modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = ScreenMargin), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CategoryStatus.entries.forEach { FilterChip(stringResource(it.label()), status == it) { actions.setStatus(it) } }
                }
            }
        }
        // The list takes the rest of the screen, so a pull down on the empty space under a short list still refreshes.
        LazyColumn(modifier = Modifier.weight(1f), contentPadding = PaddingValues(top = CardGap, bottom = bottomSpace), verticalArrangement = Arrangement.spacedBy(CardGap)) {
            message?.let { (text, isError) -> item { Message(text, isError) } }
            when {
                groups == null -> item { Box(Modifier.padding(horizontal = ScreenMargin)) { Muted(stringResource(R.string.categories_opening)) } }
                groups.isEmpty() -> item {
                    val none = items.none { it.deletedAt == null && it.kind == view.kind } && status == CategoryStatus.All && view.search.isBlank()
                    EmptyState(stringResource(if (none) R.string.categories_empty else R.string.categories_none_match))
                }
                else -> {
                    val ids = expandable(groups)
                    if (ids.isNotEmpty() && view.search.isBlank()) {
                        item {
                            val allOpen = ids.all { it in view.expanded }
                            Row(Modifier.fillMaxWidth().padding(horizontal = ScreenMargin - 12.dp), horizontalArrangement = Arrangement.End) {
                                LinkButton(stringResource(if (allOpen) R.string.categories_collapse_all else R.string.categories_expand_all), { actions.toggleAll(ids) })
                            }
                        }
                    }
                    item {
                        GroupedListCard {
                            groups.forEach { group -> row { GroupBlock(group, isOpen(group, view.expanded, view.search), actions) } }
                        }
                    }
                }
            }
        }
    }
}

private fun CategoryStatus.label() = when (this) {
    CategoryStatus.All -> R.string.categories_filter_all
    CategoryStatus.Active -> R.string.categories_filter_active
    CategoryStatus.Archived -> R.string.categories_filter_archived
}

/** What just worked, or why a write did not (and whether it is an error); a form's own error is shown in its sheet. */
@Composable
private fun messageText(view: CategoriesView): Pair<String, Boolean>? {
    val error = if (view.form == null) view.error?.let { errorText(it) } else null
    if (error != null) return error to true
    return view.notice?.let { stringResource(it.text()) to false }
}

/** Read out when it appears. */
@Composable
private fun Message(text: String, isError: Boolean) {
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
        modifier = Modifier.padding(horizontal = ScreenMargin).semantics { liveRegion = LiveRegionMode.Polite },
    )
}

private fun CategoryNotice.text() = when (this) {
    CategoryNotice.Added -> R.string.category_notice_added
    CategoryNotice.Updated -> R.string.category_notice_updated
    CategoryNotice.Archived -> R.string.category_notice_archived
    CategoryNotice.Unarchived -> R.string.category_notice_unarchived
    CategoryNotice.Deleted -> R.string.category_notice_deleted
}

@Composable
internal fun errorText(error: CategoryError): String = when (error) {
    CategoryError.Offline -> stringResource(R.string.category_error_offline)
    CategoryError.Forbidden -> stringResource(R.string.category_error_forbidden)
    CategoryError.Failed -> stringResource(R.string.category_error_failed)
    is CategoryError.Rejected -> error.detail ?: stringResource(R.string.category_error_rejected)
}

/** One main category with, when open, its subcategories underneath. */
@Composable
private fun GroupBlock(group: CategoryGroup, open: Boolean, actions: CategoriesActions) {
    val palette = LocalPalette.current
    val root = group.root
    val hasChildren = group.children.isNotEmpty()
    val state = stringResource(if (open) R.string.expanded else R.string.collapsed)
    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = RowHeight)
                .then(
                    if (hasChildren) {
                        Modifier.clickable(onClick = { actions.toggleGroup(root.id) }, role = Role.Button).semantics { stateDescription = state }
                    } else {
                        Modifier
                    },
                )
                .padding(start = 16.dp, end = 12.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Avatar(root.name)
            Column(Modifier.weight(1f)) {
                Text(root.name, style = MaterialTheme.typography.titleMedium)
                // One hint: that it is archived, or how many subcategories it has.
                if (root.archivedAt != null) {
                    ArchivedHint()
                } else if (hasChildren) {
                    Text(
                        pluralStringResource(R.plurals.category_subs, group.children.size, group.children.size),
                        style = MaterialTheme.typography.labelMedium,
                        color = palette.muted,
                    )
                }
            }
            val menuLabel = stringResource(R.string.category_actions_for, root.name)
            IconButton(onClick = { actions.openMenu(root) }, modifier = Modifier.size(TouchTarget).semantics { contentDescription = menuLabel }) {
                Icon(painterResource(R.drawable.ic_more), contentDescription = null, tint = palette.muted)
            }
            // Not a button of its own: the whole row opens and closes the group.
            if (hasChildren) {
                Icon(painterResource(if (open) R.drawable.ic_chevron_up else R.drawable.ic_chevron_down), contentDescription = null, tint = palette.muted, modifier = Modifier.size(20.dp))
            }
        }
        if (open) group.children.forEach { child -> SubcategoryRow(child, actions) }
    }
}

@Composable
private fun ArchivedHint() {
    Text(stringResource(R.string.category_archived_badge), style = MaterialTheme.typography.labelMedium, color = LocalPalette.current.muted)
}

/** A subcategory: its name, and an Archived hint when it is; a tap opens its actions. */
@Composable
private fun SubcategoryRow(row: CategoryRow, actions: CategoriesActions) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = TouchTarget)
            .clickable(onClick = { actions.openMenu(row) }, role = Role.Button)
            .padding(start = 64.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(row.name, style = MaterialTheme.typography.bodyLarge)
        if (row.archivedAt != null) ArchivedHint()
    }
}

@Composable
private fun ArchiveQuestion(category: CategoryRow, actions: CategoriesActions) {
    AlertDialog(
        onDismissRequest = actions.dismissAsk,
        title = { Text(stringResource(R.string.category_archive_title)) },
        text = { Text(stringResource(R.string.category_archive_body, category.name)) },
        confirmButton = { TextButton(onClick = actions.confirmArchive) { Text(stringResource(R.string.category_archive_confirm)) } },
        dismissButton = { TextButton(onClick = actions.dismissAsk) { Text(stringResource(R.string.category_cancel)) } },
    )
}

/** Delete asks first; when something uses the category it explains and recommends archiving, and nothing is sent. */
@Composable
private fun DeleteQuestion(ask: DeleteAsk, actions: CategoriesActions) {
    val palette = LocalPalette.current
    val name = ask.category.name
    val block = ask.block
    if (block == null) {
        AlertDialog(
            onDismissRequest = actions.dismissDeleteAsk,
            title = { Text(stringResource(R.string.category_delete_title)) },
            text = { Text(stringResource(R.string.category_delete_body, name)) },
            confirmButton = { TextButton(onClick = actions.confirmDelete) { Text(stringResource(R.string.category_delete_confirm), color = palette.danger) } },
            dismissButton = { TextButton(onClick = actions.dismissDeleteAsk) { Text(stringResource(R.string.category_cancel)) } },
        )
        return
    }
    AlertDialog(
        onDismissRequest = actions.dismissDeleteAsk,
        title = { Text(stringResource(R.string.category_delete_blocked_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                when (block) {
                    DeleteBlock.HasSubcategories -> Text(stringResource(R.string.category_delete_blocked_subcategories, name))
                    is DeleteBlock.UsedByEntries -> {
                        Text(pluralStringResource(R.plurals.category_delete_blocked_entries, block.count, name, block.count))
                        if (!ask.canArchiveInstead && ask.category.archivedAt == null) Text(stringResource(R.string.category_delete_blocked_archive_first))
                    }
                }
            }
        },
        confirmButton = {
            if (ask.canArchiveInstead && block is DeleteBlock.UsedByEntries) {
                TextButton(onClick = actions.archiveInstead) { Text(stringResource(R.string.category_delete_archive_instead)) }
            } else {
                TextButton(onClick = actions.dismissDeleteAsk) { Text(stringResource(R.string.category_delete_close)) }
            }
        },
        dismissButton = if (ask.canArchiveInstead && block is DeleteBlock.UsedByEntries) {
            { TextButton(onClick = actions.dismissDeleteAsk) { Text(stringResource(R.string.category_delete_close)) } }
        } else {
            null
        },
    )
}
