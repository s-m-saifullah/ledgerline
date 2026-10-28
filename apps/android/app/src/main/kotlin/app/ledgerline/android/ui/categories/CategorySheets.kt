package app.ledgerline.android.ui.categories

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.mirror.CategoryRow
import app.ledgerline.android.ui.design.Choice
import app.ledgerline.android.ui.design.GroupedListCard
import app.ledgerline.android.ui.design.PickRow
import app.ledgerline.android.ui.design.PickerContent
import app.ledgerline.android.ui.design.SheetTitle
import app.ledgerline.android.ui.design.PrimaryButton
import app.ledgerline.android.ui.design.RowHeight
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SegmentedControl
import app.ledgerline.android.ui.theme.LocalPalette

/** The sheet's own look, shared by the two sheets of this screen. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CategorySheet(onDismiss: () -> Unit, content: @Composable () -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
    ) { content() }
}

/** The Add and Edit form as a sheet (ADR 0046); a swipe away or Cancel closes it without saving. */
@Composable
internal fun CategoryFormSheet(
    form: CategoryForm,
    parents: List<CategoryRow>,
    hasSubcategories: Boolean,
    saving: Boolean,
    error: CategoryError?,
    actions: CategoriesActions,
) {
    CategorySheet(actions.closeForm) { CategoryFormContent(form, parents, hasSubcategories, saving, error, actions) }
}

/**
 * What the form sheet holds, apart from the sheet itself, so it can be tested and photographed: the title, the kind
 * (a choice for a new category, a plain word once it exists), the name, where it sits and one Save button.
 */
@Composable
internal fun CategoryFormContent(
    form: CategoryForm,
    parents: List<CategoryRow>,
    /** An edited main category with subcategories (archived ones too) cannot be given a parent. */
    hasSubcategories: Boolean,
    saving: Boolean,
    error: CategoryError?,
    actions: CategoriesActions,
    modifier: Modifier = Modifier,
) {
    val editing = form.editing != null
    var touched by remember { mutableStateOf(false) }
    var choosingParent by rememberSaveable { mutableStateOf(false) }
    if (choosingParent) {
        val none = stringResource(R.string.category_parent_none)
        PickerContent(
            stringResource(R.string.category_parent),
            listOf(Choice("", none)) + parents.map { Choice(it.id, it.name) },
            form.parentId ?: "",
            { id -> actions.changeForm { it.copy(parentId = id.ifEmpty { null }) }; choosingParent = false },
            { choosingParent = false },
            modifier,
        )
        return
    }
    val nameError = (touched || form.name.isNotEmpty()) && form.nameProblem
    Column(
        modifier = modifier.verticalScroll(rememberScrollState()).padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // The parent card brings its own side margin, so the other items take theirs one by one.
        val side = Modifier.padding(horizontal = ScreenMargin)
        Column(side) { SheetTitle(stringResource(if (editing) R.string.category_form_edit_title else R.string.category_form_add_title), actions.closeForm) }
        if (editing) {
            Text(
                stringResource(if (form.kind == "income") R.string.category_kind_income else R.string.category_kind_expense),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = side,
            )
        } else {
            val kindLabel = stringResource(R.string.category_kind)
            SegmentedControl(
                listOf(stringResource(R.string.category_kind_expense), stringResource(R.string.category_kind_income)),
                if (form.kind == "income") 1 else 0,
                { index -> actions.changeForm { it.copy(kind = if (index == 1) "income" else "expense", parentId = null) } },
                side.semantics { contentDescription = kindLabel },
            )
        }
        val nameLabel = stringResource(R.string.category_name)
        Column(side, verticalArrangement = Arrangement.spacedBy(8.dp)) {
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
        if (hasSubcategories) {
            Text(stringResource(R.string.category_parent_blocked), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = side)
        } else {
            val none = stringResource(R.string.category_parent_none)
            GroupedListCard {
                row { PickRow(stringResource(R.string.category_parent), parents.find { it.id == form.parentId }?.name ?: none, none, null) { choosingParent = true } }
            }
        }
        error?.let { Text(errorText(it), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = side.semantics { liveRegion = LiveRegionMode.Polite }) }
        PrimaryButton(
            stringResource(
                when {
                    saving -> R.string.category_saving
                    editing -> R.string.category_save_edit
                    else -> R.string.category_save_add
                },
            ),
            onClick = { touched = true; actions.save() },
            modifier = side.fillMaxWidth(),
            enabled = !saving && !form.nameProblem,
        )
    }
}

/** A row's actions as a sheet (ADR 0046): the same actions the web has, Delete in red. */
@Composable
internal fun CategoryActionsSheet(row: CategoryRow, items: List<CategoryRow>, actions: CategoriesActions) {
    CategorySheet(actions.closeMenu) { CategoryActionsContent(row, items, actions) }
}

/** What the actions sheet holds: Edit, Add subcategory (a main category that is not archived), Archive or Unarchive, Delete. */
@Composable
internal fun CategoryActionsContent(row: CategoryRow, items: List<CategoryRow>, actions: CategoriesActions, modifier: Modifier = Modifier) {
    val palette = LocalPalette.current
    val block = archiveBlock(row, items)
    Column(modifier = modifier.verticalScroll(rememberScrollState()).padding(bottom = 16.dp)) {
        Row(Modifier.padding(horizontal = ScreenMargin)) { SheetTitle(row.name, actions.closeMenu) }
        ActionRow(stringResource(R.string.category_edit), enabled = true) { actions.edit(row) }
        if (row.parentId == null && row.archivedAt == null) ActionRow(stringResource(R.string.category_add_sub), enabled = true) { actions.addUnder(row) }
        if (row.archivedAt == null) {
            ActionRow(stringResource(if (block == null) R.string.category_archive else R.string.category_block_archive), enabled = block == null) { actions.askArchive(row) }
        } else {
            ActionRow(stringResource(if (block == null) R.string.category_unarchive else R.string.category_block_unarchive), enabled = block == null) { actions.unarchive(row) }
        }
        // As on the web the item is always there: the question that follows says what stops a delete, and recommends archiving.
        ActionRow(stringResource(R.string.category_delete), enabled = true, color = palette.danger) { actions.askDelete(row) }
    }
}

@Composable
private fun ActionRow(text: String, enabled: Boolean, color: Color = Color.Unspecified, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, onClick = onClick, role = Role.Button)
            .heightIn(min = RowHeight)
            .padding(horizontal = ScreenMargin + 4.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text,
            style = MaterialTheme.typography.titleMedium,
            color = if (!enabled) LocalPalette.current.muted else if (color == Color.Unspecified) MaterialTheme.colorScheme.onSurface else color,
        )
    }
}
