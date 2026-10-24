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
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.mirror.EntryFilters
import app.ledgerline.android.ui.design.FilterChip
import app.ledgerline.android.ui.design.PrimaryButton
import app.ledgerline.android.ui.design.SearchBox
import app.ledgerline.android.ui.design.LinkButton
import app.ledgerline.android.ui.design.ScreenMargin
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
 * The search and the entry type above the Transactions list (ADR 0046): a search box, then chips that run along
 * the width, All, Expenses, Income and Transfers, and a Filters chip (with how many other filters are set) that
 * opens the sheet. A change applies at once (the phone has every entry, so there is nothing to wait for).
 */
@Composable
internal fun EntryFilterBar(filters: EntryFilters, onChange: (EntryFilters) -> Unit, onOpenFilters: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        SearchBox(stringResource(R.string.filters_search), filters.text, { onChange(filters.copy(text = it)) }, Modifier.padding(horizontal = ScreenMargin))
        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = ScreenMargin),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // The Filters chip comes first so it is never beyond the edge; the type chips run on after it.
            val count = filters.sheetCount
            FilterChip(
                if (count > 0) stringResource(R.string.filters_chip_count, count) else stringResource(R.string.filters_chip),
                selected = count > 0,
                onClick = onOpenFilters,
            )
            listOf(
                null to R.string.chip_all,
                "expense" to R.string.filter_kind_expense,
                "income" to R.string.filter_kind_income,
                "transfer" to R.string.filter_kind_transfer,
            ).forEach { (kind, label) ->
                FilterChip(stringResource(label), selected = filters.kind == kind, onClick = { onChange(filters.copy(kind = kind)) })
            }
        }
        if (filters.rangeInvalid) RangeInvalid()
    }
}

@Composable
private fun RangeInvalid() {
    Text(
        stringResource(R.string.filters_range_invalid),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.error,
        modifier = Modifier.padding(horizontal = ScreenMargin),
    )
}

/** The Filters sheet (ADR 0046): the account, category, tag, dates and status, Clear filters while any is set, and Done. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun EntryFiltersSheet(filters: EntryFilters, options: FilterOptions, onChange: (EntryFilters) -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
    ) {
        EntryFiltersSheetContent(filters, options, onChange, onDismiss)
    }
}

/** What the sheet holds, apart from the sheet itself, so it can be tested and photographed. */
@Composable
internal fun EntryFiltersSheetContent(filters: EntryFilters, options: FilterOptions, onChange: (EntryFilters) -> Unit, onDone: () -> Unit) {
    Column(
        modifier = Modifier.verticalScroll(rememberScrollState()).padding(horizontal = ScreenMargin).padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.filters_chip), style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f).semantics { heading() })
            if (filters.sheetCount > 0 || filters.text.isNotBlank() || filters.kind != null) {
                LinkButton(stringResource(R.string.filters_clear), { onChange(EntryFilters()) })
            }
        }
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
        val statuses = listOf(
            Choice(Any, stringResource(R.string.filter_status_all)),
            Choice("cleared", stringResource(R.string.filter_status_cleared)),
            Choice("pending", stringResource(R.string.filter_status_pending)),
        )
        ComboField(stringResource(R.string.filter_status), statuses, filters.status ?: Any, { onChange(filters.copy(status = it.ifEmpty { null })) }, emptyText = "")
        if (filters.rangeInvalid) RangeInvalid()
        PrimaryButton(stringResource(R.string.filters_done), onDone, modifier = Modifier.fillMaxWidth())
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
