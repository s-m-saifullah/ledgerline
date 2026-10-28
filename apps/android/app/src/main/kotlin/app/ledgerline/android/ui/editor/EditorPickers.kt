package app.ledgerline.android.ui.editor

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.ui.design.RowHeight
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SearchBox
import app.ledgerline.android.ui.design.SheetTitle
import app.ledgerline.android.ui.theme.LocalPalette

/** What a picker sheet chooses (ADR 0046): the editor's Account, To, Category and tag pickers all look the same. */
enum class Picker { Account, To, Category, Tag }

/** The sheet itself; a swipe away or Cancel chooses nothing. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PickerSheet(onDismiss: () -> Unit, content: @Composable () -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
    ) { content() }
}

/**
 * What a picker holds, apart from the sheet, so it can be tested and photographed: a title with Cancel, a search box
 * only from [PickerSearchFrom] choices on (fixed above the list, so it never moves while typing), the choices as 56 dp
 * rows with a check on the chosen one, and, for categories, a "New category" row pinned under the list.
 */
@Composable
internal fun PickerContent(
    title: String,
    choices: List<Choice>,
    selected: String?,
    onSelect: (String) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    onNew: (() -> Unit)? = null,
) {
    var query by remember { mutableStateOf("") }
    val shown = pickerChoices(choices, query)
    // Currencies are said only when the choices mix them, so a one-currency ledger stays quiet.
    val mixed = choices.map { it.currency }.filter { it.isNotEmpty() }.toSet().size > 1
    // With a search box the sheet keeps one height, so a shorter result never shrinks it and moves the box; a few rows wrap.
    val sized = if (choices.size >= PickerSearchFrom) Modifier.fillMaxHeight(PickerSheetHeight) else Modifier.heightIn(max = 520.dp)
    Column(modifier = modifier.fillMaxWidth().then(sized), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Column(Modifier.padding(horizontal = ScreenMargin)) { SheetTitle(title, onCancel) }
        if (choices.size >= PickerSearchFrom) {
            SearchBox(stringResource(R.string.editor_pick_search), query, { query = it }, Modifier.padding(horizontal = ScreenMargin))
        }
        LazyColumn(modifier = Modifier.weight(1f, fill = false)) {
            if (shown.isEmpty()) {
                item { Text(stringResource(R.string.editor_pick_none), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = ScreenMargin + 4.dp, vertical = 12.dp)) }
            }
            items(shown, key = { it.id }) { choice ->
                PickerRow(
                    if (choice.archived) stringResource(R.string.editor_archived, choice.label) else choice.label,
                    choice.currency.takeIf { mixed },
                    choice.id == selected,
                ) { onSelect(choice.id) }
            }
        }
        // Pinned under the list, so it is in reach however many categories there are.
        if (onNew != null) {
            Row(
                modifier = Modifier.fillMaxWidth().clickable(onClick = onNew, role = Role.Button).heightIn(min = RowHeight).padding(horizontal = ScreenMargin + 4.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(painterResource(R.drawable.ic_add), contentDescription = null, tint = LocalPalette.current.accent, modifier = Modifier.size(18.dp))
                Text(stringResource(R.string.editor_new_category), style = MaterialTheme.typography.titleMedium, color = LocalPalette.current.accent)
            }
        }
    }
}

@Composable
private fun PickerRow(label: String, trailing: String?, chosen: Boolean, onClick: () -> Unit) {
    val palette = LocalPalette.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .selectable(selected = chosen, onClick = onClick, role = Role.RadioButton)
            .heightIn(min = RowHeight)
            .padding(horizontal = ScreenMargin + 4.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(label, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
        if (trailing != null) Text(trailing, style = MaterialTheme.typography.labelMedium, color = palette.muted)
        // A check, not only a colour, says which one is chosen.
        if (chosen) Icon(painterResource(R.drawable.ic_check), contentDescription = stringResource(R.string.editor_pick_selected), tint = palette.accent, modifier = Modifier.size(20.dp))
    }
}

/** The "New category" name box inside the category picker; Cancel goes back to the list. */
@Composable
internal fun NewCategorySheetContent(box: NewCategory, onName: (String) -> Unit, onCreate: () -> Unit, onCancel: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth().padding(horizontal = ScreenMargin).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SheetTitle(stringResource(R.string.editor_new_category), onCancel)
        NewCategoryFields(box, onName, onCreate)
    }
}
