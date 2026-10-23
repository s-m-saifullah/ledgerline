package app.ledgerline.android.ui.editor

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.Icon
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R

/**
 * Tags as on the web: a chip for each chosen tag (a tap removes it), and a box to find another by typing. Archived
 * tags are offered only while they are chosen, and an entry holds at most [MaxTagsPerEntry]. Tags are made on the web.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TagPicker(tags: List<Choice>, chosen: List<String>, onAdd: (String) -> Unit, onRemove: (String) -> Unit) {
    val shown = chosen.mapNotNull { id -> tags.find { it.id == id } }
    val full = chosen.size >= MaxTagsPerEntry
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (shown.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                shown.forEach { tag ->
                    val name = if (tag.archived) stringResource(R.string.editor_archived, tag.label) else tag.label
                    InputChip(
                        selected = true,
                        onClick = { onRemove(tag.id) },
                        label = { Text(name, style = MaterialTheme.typography.labelLarge) },
                        trailingIcon = {
                            Icon(painterResource(R.drawable.ic_close), contentDescription = stringResource(R.string.editor_tag_remove, tag.label))
                        },
                        modifier = Modifier.heightIn(min = 48.dp),
                    )
                }
            }
        }
        ComboField(
            label = stringResource(R.string.editor_tags),
            choices = tags.filter { !it.archived && it.id !in chosen },
            selected = null,
            onSelect = onAdd,
            emptyText = stringResource(R.string.editor_no_matching_tags),
            placeholder = stringResource(R.string.editor_tags_find),
            hint = if (full) stringResource(R.string.editor_tags_full) else null,
            enabled = !full,
            clearAfterPick = true,
        )
    }
}
