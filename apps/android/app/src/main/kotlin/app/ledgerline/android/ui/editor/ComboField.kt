package app.ledgerline.android.ui.editor

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import app.ledgerline.android.R
import app.ledgerline.android.ui.design.Choice
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction

/** The choices whose label contains what was typed (ignoring case and the spaces around it); all of them when nothing is typed. */
fun List<Choice>.matching(query: String): List<Choice> {
    val term = query.trim()
    return if (term.isEmpty()) this else filter { it.label.contains(term, ignoreCase = true) }
}

/**
 * One field: tap to open the list, type to narrow it, tap a choice, as the web's combobox (CategoryPicker). While the
 * list is open the box is for typing (the current choice shows as its hint); closed, it shows the current choice.
 * A [hint] shows under the box when there is no error. The keyboard's Done picks the first match. With [clearAfterPick] the box empties after a pick and keeps the keyboard
 * (the tag picker adds a chip and is ready for another); otherwise the pick closes the keyboard too.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ComboField(
    label: String,
    choices: List<Choice>,
    selected: String?,
    onSelect: (String) -> Unit,
    emptyText: String,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    error: String? = null,
    hint: String? = null,
    enabled: Boolean = true,
    clearAfterPick: Boolean = false,
) {
    var open by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    val focus = LocalFocusManager.current
    val archivedTemplate = stringResource(R.string.editor_archived)
    fun Choice.shown() = if (this.archived) archivedTemplate.format(this.label) else this.label
    val current = choices.find { it.id == selected }?.shown().orEmpty()
    val matches = choices.matching(query)
    val pick = { choice: Choice ->
        onSelect(choice.id)
        open = false
        query = ""
        if (!clearAfterPick) focus.clearFocus()
    }
    ExposedDropdownMenuBox(expanded = open && enabled, onExpandedChange = { open = it; query = "" }, modifier = modifier) {
        OutlinedTextField(
            value = if (open) query else if (clearAfterPick) "" else current,
            onValueChange = {
                query = it
                open = true
            },
            label = { Text(label) },
            placeholder = { Text(if (open && current.isNotEmpty() && !clearAfterPick) current else placeholder) },
            isError = error != null,
            supportingText = (error ?: hint)?.let { { Text(it) } },
            enabled = enabled,
            singleLine = true,
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open && enabled) },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = {
                val first = matches.firstOrNull()
                if (open && first != null) pick(first) else {
                    open = false
                    query = ""
                    focus.clearFocus()
                }
            }),
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryEditable),
        )
        ExposedDropdownMenu(expanded = open && enabled, onDismissRequest = { open = false; query = "" }) {
            matches.forEach { choice ->
                DropdownMenuItem(
                    text = {
                        Text(choice.shown(), color = if (choice.id == selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                    },
                    onClick = { pick(choice) },
                    modifier = Modifier.semantics { this.selected = choice.id == selected },
                )
            }
            if (matches.isEmpty()) {
                DropdownMenuItem(text = { Text(emptyText, color = MaterialTheme.colorScheme.onSurfaceVariant) }, onClick = {}, enabled = false)
            }
        }
    }
}
