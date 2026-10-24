package app.ledgerline.android.ui.categories

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.mirror.CategoryRow
import app.ledgerline.android.ui.design.BackLink
import app.ledgerline.android.ui.design.CardGap
import app.ledgerline.android.ui.design.ChoiceField
import app.ledgerline.android.ui.design.LedgerCard
import app.ledgerline.android.ui.design.PageHeader
import app.ledgerline.android.ui.design.PrimaryButton
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SearchField
import app.ledgerline.android.ui.design.SecondaryButton
import app.ledgerline.android.ui.design.narrowingRoom
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
)

/**
 * The Categories screen as plain data (ADR 0045): the list (or, while one is open, the Add / Edit form) and the archive
 * question. [items] is every category of the ledger (the list rules need the whole tree); [groups] is null until the
 * mirror has a ledger.
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
    val form = view.form
    if (form != null) {
        val editing = form.editing
        val hasSubcategories = editing != null && items.any { it.deletedAt == null && it.parentId == editing.id }
        CategoryFormContent(form, parentChoices(items, form.kind, editing), hasSubcategories, view.saving, view.error, actions, bottomSpace, modifier)
        return
    }
    LazyColumn(modifier = modifier, contentPadding = PaddingValues(bottom = bottomSpace), verticalArrangement = Arrangement.spacedBy(CardGap)) {
        item { BackLink(stringResource(R.string.back_more), actions.onBack) }
        item {
            PageHeader(
                stringResource(R.string.categories_title),
                eyebrow = stringResource(R.string.eyebrow_personal),
                subtitle = stringResource(R.string.categories_subtitle),
            )
        }
        if (groups != null) {
            item {
                PrimaryButton(
                    stringResource(R.string.categories_add),
                    actions.add,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = ScreenMargin),
                    enabled = !view.saving,
                )
            }
        }
        item { Messages(view) }
        item { KindSwitch(view.kind, Modifier.padding(horizontal = ScreenMargin), actions.setKind) }
        item {
            ChoiceField(
                label = stringResource(R.string.categories_view),
                options = CategoryStatus.entries.map { it.name to stringResource(it.label()) },
                selected = view.status.name,
                onSelect = { actions.setStatus(CategoryStatus.valueOf(it)) },
                modifier = Modifier.padding(horizontal = ScreenMargin),
            )
        }
        item { SearchField(stringResource(R.string.categories_search), view.search, actions.setSearch) }
        when {
            groups == null -> item { Note(stringResource(R.string.categories_opening)) }
            groups.isEmpty() -> item {
                val none = items.none { it.deletedAt == null && it.kind == view.kind } && view.status == CategoryStatus.All && view.search.isBlank()
                LedgerCard {
                    Text(
                        stringResource(if (none) R.string.categories_empty_title else R.string.categories_none_match),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Note(stringResource(if (none) R.string.categories_empty_detail else R.string.categories_none_match_detail))
                }
            }
            else -> groups.forEach { group ->
                item(key = group.root.id) {
                    LedgerCard(padding = PaddingValues(vertical = 4.dp, horizontal = 16.dp)) {
                        if (group.showRoot) CategoryRowView(group.root, child = false, items, actions)
                        group.children.forEach { CategoryRowView(it, child = true, items, actions) }
                    }
                }
            }
        }
        // As on Clients and Loans: a shorter result must not pull the scroll back and slide the search field down.
        narrowingRoom(narrowed = view.search.isNotEmpty() || view.status != CategoryStatus.All)
    }
}

private fun CategoryStatus.label() = when (this) {
    CategoryStatus.All -> R.string.categories_filter_all
    CategoryStatus.Active -> R.string.categories_filter_active
    CategoryStatus.Archived -> R.string.categories_filter_archived
}

@Composable
private fun Note(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = ScreenMargin, vertical = 4.dp))
}

/** What just worked, or why a write did not; read out when it appears. */
@Composable
private fun Messages(view: CategoriesView) {
    val notice = view.notice?.let { stringResource(it.text()) }
    val error = view.error?.let { errorText(it) }
    val text = error ?: notice ?: return
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = if (error != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
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

/** Expense and Income, as the web's two kind buttons. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun KindSwitch(kind: String, modifier: Modifier = Modifier, onChange: (String) -> Unit) {
    val label = stringResource(R.string.category_kind)
    SingleChoiceSegmentedButtonRow(modifier = modifier.fillMaxWidth().semantics { contentDescription = label }) {
        listOf("expense" to R.string.category_kind_expense, "income" to R.string.category_kind_income).forEachIndexed { index, (value, text) ->
            SegmentedButton(
                selected = kind == value,
                onClick = { onChange(value) },
                shape = SegmentedButtonDefaults.itemShape(index, 2),
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text(stringResource(text)) }
        }
    }
}

/** One category: its name, an Archived badge, and a menu of what can be done with it. */
@Composable
private fun CategoryRowView(row: CategoryRow, child: Boolean, items: List<CategoryRow>, actions: CategoriesActions) {
    val palette = LocalPalette.current
    val block = archiveBlock(row, items)
    var open by remember { mutableStateOf(false) }
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(start = if (child) 20.dp else 0.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f).padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(row.name, style = if (child) MaterialTheme.typography.bodyLarge else MaterialTheme.typography.titleMedium)
            if (row.archivedAt != null) {
                Text(stringResource(R.string.category_archived_badge), style = MaterialTheme.typography.labelMedium, color = palette.muted)
            }
        }
        val menuLabel = stringResource(R.string.category_actions_for, row.name)
        IconButton(onClick = { open = true }, modifier = Modifier.semantics { contentDescription = menuLabel }) {
            Icon(painterResource(R.drawable.ic_more), contentDescription = null, tint = palette.muted)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text(stringResource(R.string.category_edit)) }, onClick = { open = false; actions.edit(row) })
            if (row.archivedAt == null) {
                DropdownMenuItem(
                    text = { Text(stringResource(if (block == null) R.string.category_archive else R.string.category_block_archive)) },
                    enabled = block == null,
                    onClick = { open = false; actions.askArchive(row) },
                )
            } else {
                DropdownMenuItem(
                    text = { Text(stringResource(if (block == null) R.string.category_unarchive else R.string.category_block_unarchive)) },
                    enabled = block == null,
                    onClick = { open = false; actions.unarchive(row) },
                )
            }
            // As on the web the item is always there: the question that follows says what stops a delete, and recommends archiving.
            DropdownMenuItem(
                text = { Text(stringResource(R.string.category_delete), color = palette.danger) },
                onClick = { open = false; actions.askDelete(row) },
            )
        }
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

/** The Add and Edit form: a name, the kind (fixed once the category exists) and where it sits. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun CategoryFormContent(
    form: CategoryForm,
    parents: List<CategoryRow>,
    /** An edited main category with subcategories (archived ones too) cannot be given a parent. */
    hasSubcategories: Boolean,
    saving: Boolean,
    error: CategoryError?,
    actions: CategoriesActions,
    bottomSpace: Dp,
    modifier: Modifier = Modifier,
) {
    val editing = form.editing != null
    var touched by remember { mutableStateOf(false) }
    val nameError = (touched || form.name.isNotEmpty()) && form.nameProblem
    LazyColumn(modifier = modifier, contentPadding = PaddingValues(bottom = bottomSpace), verticalArrangement = Arrangement.spacedBy(CardGap)) {
        item { BackLink(stringResource(R.string.category_back_to_list), actions.closeForm) }
        item {
            PageHeader(
                stringResource(if (editing) R.string.category_form_edit_title else R.string.category_form_add_title),
                eyebrow = stringResource(R.string.eyebrow_personal),
                subtitle = stringResource(if (editing) R.string.category_form_edit_detail else R.string.category_form_add_detail),
            )
        }
        item {
            LedgerCard {
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    val nameLabel = stringResource(R.string.category_name)
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(nameLabel, style = MaterialTheme.typography.bodyMedium)
                        OutlinedTextField(
                            value = form.name,
                            onValueChange = { typed -> touched = true; actions.changeForm { it.copy(name = typed.take(MaxCategoryName + 20)) } },
                            isError = nameError,
                            supportingText = if (nameError) ({
                                Text(stringResource(if (form.trimmedName.isEmpty()) R.string.category_name_required else R.string.category_name_too_long))
                            }) else null,
                            singleLine = true,
                            enabled = !saving,
                            shape = MaterialTheme.shapes.small,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                            modifier = Modifier.fillMaxWidth().semantics { contentDescription = nameLabel },
                        )
                    }
                    if (editing) {
                        val kindName = stringResource(if (form.kind == "income") R.string.category_kind_income else R.string.category_kind_expense)
                        Text(stringResource(R.string.category_kind_fixed, kindName), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(stringResource(R.string.category_kind), style = MaterialTheme.typography.bodyMedium)
                            KindSwitch(form.kind) { kind -> actions.changeForm { it.copy(kind = kind, parentId = null) } }
                        }
                    }
                    if (hasSubcategories) {
                        Text(stringResource(R.string.category_parent_blocked), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        ChoiceField(
                            label = stringResource(R.string.category_parent),
                            options = listOf("" to stringResource(R.string.category_parent_none)) + parents.map { it.id to it.name },
                            selected = form.parentId ?: "",
                            onSelect = { id -> actions.changeForm { it.copy(parentId = id.ifEmpty { null }) } },
                        )
                    }
                    error?.let { Text(errorText(it), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        PrimaryButton(
                            stringResource(
                                when {
                                    saving -> R.string.category_saving
                                    editing -> R.string.category_save_edit
                                    else -> R.string.category_save_add
                                },
                            ),
                            onClick = { touched = true; actions.save() },
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !saving && !form.nameProblem,
                        )
                        SecondaryButton(stringResource(R.string.category_cancel), actions.closeForm, modifier = Modifier.fillMaxWidth(), enabled = !saving)
                    }
                }
            }
        }
    }
}
