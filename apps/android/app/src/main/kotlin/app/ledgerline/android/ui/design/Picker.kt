package app.ledgerline.android.ui.design

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.ui.theme.LocalPalette

/*
 * The pieces every form of the redesign shares (ADR 0046): the picker sheet with its choices, the row that opens it, and
 * the row with a text box. The editor, the Categories form, sign-in and the address screen are all built from them.
 */

/** One entry of a list the owner picks from; [archived] ones are offered only while they are the current choice. */
data class Choice(val id: String, val label: String, val currency: String = "", val archived: Boolean = false)

/** A picker sheet offers a search box from this many choices on (the same rule as Loans' search). */
const val PickerSearchFrom = 8

/** A picker with a search box takes this share of the screen height and keeps it while the list narrows. */
const val PickerSheetHeight = 0.65f

/** The choices whose label has [query] in it, ignoring case; all of them for a blank query. */
fun pickerChoices(choices: List<Choice>, query: String): List<Choice> {
    val term = query.trim()
    return if (term.isEmpty()) choices else choices.filter { it.label.contains(term, ignoreCase = true) }
}

/** The sheet itself; a swipe away or Cancel chooses nothing. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PickerSheet(onDismiss: () -> Unit, content: @Composable () -> Unit) {
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
fun PickerContent(
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


/** A row that opens a picker: the label, the chosen value (or a hint), a chevron, and a problem in words under it. */
@Composable
fun PickRow(label: String, value: String, placeholder: String, error: String?, onClick: () -> Unit) {
    val palette = LocalPalette.current
    Column(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick, role = Role.Button).heightIn(min = RowHeight).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(label, style = MaterialTheme.typography.bodyMedium, color = palette.muted)
            Text(
                value.ifEmpty { placeholder },
                style = MaterialTheme.typography.titleMedium,
                color = if (value.isEmpty()) palette.muted else palette.text,
                textAlign = TextAlign.End,
                modifier = Modifier.weight(1f),
            )
            Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null, tint = palette.muted, modifier = Modifier.size(20.dp))
        }
        if (error != null) Text(error, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error)
    }
}

/**
 * A row with a text box: the label, and what is typed to its right (48 dp at least), an optional [trailing] piece such as
 * Show, and a problem in words under it. [fieldModifier] is for the box itself (autofill hints, focus).
 */
@Composable
fun InputRow(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
    enabled: Boolean = true,
    error: String? = null,
    placeholder: String? = null,
    /** The label above a box that is as wide as the row, for a long value such as an address; the default puts the label beside it. */
    stacked: Boolean = false,
    trailing: (@Composable () -> Unit)? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    fieldModifier: Modifier = Modifier,
) {
    val palette = LocalPalette.current
    val field: @Composable (Modifier, TextAlign, Alignment) -> Unit = { size, align, place ->
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = singleLine,
            enabled = enabled,
            textStyle = MaterialTheme.typography.titleMedium.copy(color = palette.text, textAlign = align),
            cursorBrush = SolidColor(palette.accent),
            keyboardOptions = keyboardOptions,
            keyboardActions = keyboardActions,
            visualTransformation = visualTransformation,
            modifier = fieldModifier.then(size).heightIn(min = TouchTarget).semantics { contentDescription = label },
            decorationBox = { inner ->
                Box(contentAlignment = place, modifier = Modifier.heightIn(min = TouchTarget)) {
                    if (value.isEmpty() && placeholder != null) Text(placeholder, style = MaterialTheme.typography.titleMedium, color = palette.muted, maxLines = 1)
                    inner()
                }
            },
        )
    }
    Column(modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
        if (stacked) {
            Text(label, style = MaterialTheme.typography.bodyMedium, color = palette.muted, modifier = Modifier.padding(top = 8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                field(Modifier.weight(1f), TextAlign.Start, Alignment.CenterStart)
                trailing?.invoke()
            }
        } else {
            Row(
                modifier = Modifier.fillMaxWidth().heightIn(min = RowHeight - 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(label, style = MaterialTheme.typography.bodyMedium, color = palette.muted)
                field(Modifier.weight(1f), TextAlign.End, Alignment.CenterEnd)
                trailing?.invoke()
            }
        }
        if (error != null) Text(error, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(bottom = 4.dp))
    }
}
