package app.ledgerline.android.ui.design

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.online.AutoLoadCap
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.Paged
import app.ledgerline.android.ui.theme.LocalPalette

/* Lists, links and fields shared by the screens that browse people (Clients, Loans), named after the web's. */

/** `← More`, `All clients`: the way back from a screen opened from another. */
@Composable
fun BackLink(text: String, onClick: () -> Unit) {
    LinkButton(
        text = "←  $text",
        onClick = onClick,
        modifier = Modifier.padding(horizontal = ScreenMargin - 12.dp),
    )
}

/** A label above a bordered search field, as the web's. */
@Composable
fun SearchField(label: String, value: String, onChange: (String) -> Unit) {
    Column(modifier = Modifier.padding(horizontal = ScreenMargin), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, style = MaterialTheme.typography.bodyMedium)
        OutlinedTextField(
            value = value,
            onValueChange = { onChange(it.take(200)) },
            singleLine = true,
            // A cross at the right end clears the field; it shows only while there is something to clear.
            trailingIcon = if (value.isEmpty()) null else {
                {
                    IconButton(onClick = { onChange("") }) {
                        Icon(painterResource(R.drawable.ic_close), contentDescription = stringResource(R.string.clear_search), modifier = Modifier.size(20.dp))
                    }
                }
            },
            shape = MaterialTheme.shapes.small,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        )
    }
}

/** A label above a bordered choice that opens a menu, as the web's native select. */
@Composable
fun ChoiceField(
    label: String,
    options: List<Pair<String, String>>,
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    /** 48 dp as the web's select; 56 dp where it sits beside a text box, which is that tall. */
    minHeight: Dp = 48.dp,
) {
    val palette = LocalPalette.current
    var open by remember { mutableStateOf(false) }
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, style = MaterialTheme.typography.bodyMedium)
        Box {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = minHeight)
                    .background(palette.surface, MaterialTheme.shapes.small)
                    .border(1.dp, palette.fieldBorder, MaterialTheme.shapes.small)
                    .clickable(onClick = { open = true }, role = Role.DropdownList)
                    .padding(horizontal = 16.dp, vertical = 8.dp)
                    .semantics { contentDescription = label },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(options.firstOrNull { it.first == selected }?.second.orEmpty(), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                Icon(painterResource(R.drawable.ic_chevron_down), contentDescription = null, modifier = Modifier.size(20.dp))
            }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                options.forEach { (value, name) ->
                    DropdownMenuItem(text = { Text(name) }, onClick = { open = false; onSelect(value) })
                }
            }
        }
    }
}

/** `Load more …` under a list that has another page; shows a reading line while it loads or could not. */
@Composable
fun LoadMore(label: String, loading: Boolean, failed: Boolean, onClick: () -> Unit) {
    Column(modifier = Modifier.padding(horizontal = ScreenMargin), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (failed) {
            Text(stringResource(R.string.load_more_failed), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
        }
        SecondaryButton(if (loading) stringResource(R.string.loading) else label, onClick = onClick, enabled = !loading)
    }
}

/** A borderless block of a muted line (a label's note, an empty list's hint) between cards. */
@Composable
fun MutedLine(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = ScreenMargin))
}

/**
 * Room at the end of a list that is being narrowed by a search or a filter: as tall as the visible area, so a shorter
 * result never leaves the list shorter than the scroll position needs. Without it, filtering while scrolled (the
 * keyboard open) pulled the scroll back and slid the search field down under the owner's fingers.
 */
fun LazyListScope.narrowingRoom(narrowed: Boolean) {
    if (narrowed) item(key = "narrowing-room") { Spacer(Modifier.fillParentMaxHeight()) }
}

/**
 * Asks for the next page as soon as the one shown has arrived, until there is none or [AutoLoadCap] rows are shown, so
 * the owner never has to press Load more for a list that is a few dozen rows long. Runs only while the screen shows
 * the list, which keeps the view model's rule that nothing is read for a screen that is not on show; a failed page
 * stops it (the list's own Load more button retries).
 */
@Composable
fun <T> AutoLoadMore(state: Online<Paged<T>>, loadMore: () -> Unit) {
    val ready = (state as? Online.Ready)?.value
    LaunchedEffect(ready) {
        if (ready != null && ready.hasMore && !ready.loadingMore && !ready.moreFailed && ready.items.size < AutoLoadCap) loadMore()
    }
}
