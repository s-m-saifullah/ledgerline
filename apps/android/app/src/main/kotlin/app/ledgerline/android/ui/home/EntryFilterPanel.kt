package app.ledgerline.android.ui.home

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.mirror.EntryFilters
import app.ledgerline.android.ui.design.LedgerCard
import app.ledgerline.android.ui.design.LinkButton
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SearchField
import app.ledgerline.android.ui.editor.Choice
import app.ledgerline.android.ui.editor.ComboField
import app.ledgerline.android.ui.format.formatEntryDate
import app.ledgerline.android.ui.theme.LocalPalette
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/** The id the "All ..." choice of a filter box carries; picking it clears that filter. */
private const val Any = ""

/**
 * The web's filters above the Transactions list: a search box, a "Filter entries" section with Account, Category, Tag,
 * From and To dates, Entry type and Status, and Clear filters while any is set. A change applies at once (the phone
 * has every entry, so there is nothing to wait for; the web needs an Apply button because it asks the server).
 */
@Composable
internal fun EntryFiltersPanel(
    filters: EntryFilters,
    options: FilterOptions,
    expanded: Boolean,
    onToggle: () -> Unit,
    onChange: (EntryFilters) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SearchField(stringResource(R.string.filters_search), filters.text) { onChange(filters.copy(text = it)) }
        DisclosureRow(
            text = if (filters.panelCount > 0) stringResource(R.string.filters_title_count, filters.panelCount) else stringResource(R.string.filters_title),
            expanded = expanded,
            onToggle = onToggle,
        )
        if (expanded) {
            LedgerCard(padding = androidx.compose.foundation.layout.PaddingValues(16.dp)) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    FilterBox(R.string.filter_account, R.string.filter_all_accounts, R.string.filter_no_match_account, options.accounts, filters.accountId) {
                        onChange(filters.copy(accountId = it))
                    }
                    FilterBox(R.string.filter_category, R.string.filter_all_categories, R.string.filter_no_match_category, options.categories, filters.categoryId) {
                        // The Category filter finds a main category's subcategories too, as on the web.
                        onChange(filters.copy(categoryId = it, includeSubcategories = true))
                    }
                    FilterBox(R.string.filter_tag, R.string.filter_all_tags, R.string.filter_no_match_tag, options.tags, filters.tagId) {
                        onChange(filters.copy(tagId = it))
                    }
                    DateField(stringResource(R.string.filter_from), filters.from) { onChange(filters.copy(from = it)) }
                    DateField(stringResource(R.string.filter_to), filters.to) { onChange(filters.copy(to = it)) }
                    val kinds = listOf(
                        Choice(Any, stringResource(R.string.filter_kind_all)),
                        Choice("expense", stringResource(R.string.filter_kind_expense)),
                        Choice("income", stringResource(R.string.filter_kind_income)),
                        Choice("transfer", stringResource(R.string.filter_kind_transfer)),
                    )
                    ComboField(stringResource(R.string.filter_kind), kinds, filters.kind ?: Any, { onChange(filters.copy(kind = it.ifEmpty { null })) }, emptyText = "")
                    val statuses = listOf(
                        Choice(Any, stringResource(R.string.filter_status_all)),
                        Choice("cleared", stringResource(R.string.filter_status_cleared)),
                        Choice("pending", stringResource(R.string.filter_status_pending)),
                    )
                    ComboField(stringResource(R.string.filter_status), statuses, filters.status ?: Any, { onChange(filters.copy(status = it.ifEmpty { null })) }, emptyText = "")
                }
            }
        }
        if (filters.applied) {
            LinkButton(stringResource(R.string.filters_clear), { onChange(EntryFilters()) }, modifier = Modifier.padding(horizontal = ScreenMargin - 12.dp))
        }
        if (filters.rangeInvalid) {
            Text(
                stringResource(R.string.filters_range_invalid),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(horizontal = ScreenMargin),
            )
        }
    }
}

/** The web's `<details>` summary: the whole row opens and closes the section. */
@Composable
private fun DisclosureRow(text: String, expanded: Boolean, onToggle: () -> Unit) {
    val closed = stringResource(R.string.collapsed)
    val open = stringResource(R.string.expanded)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clickable(onClick = onToggle, role = Role.Button)
            .semantics { stateDescription = if (expanded) open else closed }
            .padding(horizontal = ScreenMargin),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
        Icon(
            painterResource(R.drawable.ic_chevron_down),
            contentDescription = null,
            modifier = Modifier.size(20.dp).rotate(if (expanded) 180f else 0f),
        )
    }
}

/** One filter box: "All ..." first, then the choices; picking "All ..." clears the filter. */
@Composable
private fun FilterBox(label: Int, all: Int, none: Int, choices: List<Choice>, selected: String?, onPick: (String?) -> Unit) {
    val every = Choice(Any, stringResource(all))
    ComboField(stringResource(label), listOf(every) + choices, selected ?: Any, { onPick(it.ifEmpty { null }) }, emptyText = stringResource(none))
}

/** A date box: shows the chosen day (or "Any date"), opens the phone's date picker, and has a cross to clear it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun DateField(label: String, value: String?, onChange: (String?) -> Unit) {
    var picking by rememberSaveable { mutableStateOf(false) }
    Box {
        OutlinedTextField(
            value = value?.let { runCatching { formatEntryDate(it) }.getOrDefault(it) } ?: "",
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            placeholder = { Text(stringResource(R.string.filter_any_date)) },
            singleLine = true,
            trailingIcon = if (value == null) null else {
                {
                    IconButton(onClick = { onChange(null) }) {
                        Icon(painterResource(R.drawable.ic_close), contentDescription = stringResource(R.string.filter_clear_date, label), modifier = Modifier.size(20.dp))
                    }
                }
            },
            modifier = Modifier.fillMaxWidth(),
        )
        // Over the box (but not its cross) so a tap anywhere else opens the picker.
        Box(modifier = Modifier.matchParentSize().padding(end = if (value == null) 0.dp else 56.dp).clickable(role = Role.Button) { picking = true })
    }
    if (picking) {
        val initial = value?.let { runCatching { LocalDate.parse(it) }.getOrNull() }?.atStartOfDay()?.toInstant(ZoneOffset.UTC)?.toEpochMilli()
        val picker = rememberDatePickerState(initialSelectedDateMillis = initial)
        DatePickerDialog(
            onDismissRequest = { picking = false },
            confirmButton = {
                TextButton(shape = MaterialTheme.shapes.small, onClick = {
                    picker.selectedDateMillis?.let { millis -> onChange(Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate().toString()) }
                    picking = false
                }) { Text(stringResource(R.string.editor_date_ok)) }
            },
            dismissButton = { TextButton(shape = MaterialTheme.shapes.small, onClick = { picking = false }) { Text(stringResource(R.string.cancel)) } },
        ) { DatePicker(state = picker) }
    }
}
