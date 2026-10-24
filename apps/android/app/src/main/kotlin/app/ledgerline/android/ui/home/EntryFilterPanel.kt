package app.ledgerline.android.ui.home

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
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
import app.ledgerline.android.ui.design.FiltersButton
import app.ledgerline.android.ui.design.SecondaryButton
import app.ledgerline.android.ui.design.SegmentedControl
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
 * The search and the entry type above the Transactions list (ADR 0046): a search box with a Filters button
 * beside it (and how many other filters are set), then the type chips, All, Expenses, Income and Transfers.
 * A search or a type applies at once (the phone has every entry, so there is nothing to wait for).
 */
@Composable
internal fun EntryFilterBar(filters: EntryFilters, onChange: (EntryFilters) -> Unit, onOpenFilters: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(modifier = Modifier.padding(horizontal = ScreenMargin), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            SearchBox(stringResource(R.string.filters_search), filters.text, { onChange(filters.copy(text = it)) }, Modifier.weight(1f))
            FiltersButton(filters.sheetCount, onOpenFilters)
        }
        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = ScreenMargin),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
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

/** The Filters sheet (ADR 0046): what is chosen in it takes effect on Apply; Cancel and a swipe away leave the list as it was. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun EntryFiltersSheet(filters: EntryFilters, options: FilterOptions, onChange: (EntryFilters) -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
    ) {
        EntryFiltersSheetContent(filters, options, onApply = { onChange(it); onDismiss() }, onCancel = onDismiss)
    }
}

/**
 * What the sheet holds, apart from the sheet itself, so it can be tested and photographed: the account and
 * category, the tag, the date range and the status (two to a row where the width allows), Reset all while
 * any is set, and Cancel and Apply. The choices are a draft until Apply.
 */
@Composable
internal fun EntryFiltersSheetContent(filters: EntryFilters, options: FilterOptions, onApply: (EntryFilters) -> Unit, onCancel: () -> Unit) {
    var draft by remember { mutableStateOf(filters) }
    Column(
        modifier = Modifier.verticalScroll(rememberScrollState()).padding(horizontal = ScreenMargin).padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.filters_chip), style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f).semantics { heading() })
            if (draft.sheetCount > 0) {
                LinkButton(stringResource(R.string.filters_reset), {
                    draft = draft.copy(accountId = null, categoryId = null, tagId = null, from = null, to = null, status = null)
                })
            }
        }
        BoxWithConstraints {
            val twoColumns = sheetTwoColumns(maxWidth, LocalDensity.current.fontScale)
            val account: @Composable (Modifier) -> Unit = { m ->
                Box(m) {
                    FilterBox(R.string.filter_account, R.string.filter_all_accounts, R.string.filter_no_match_account, options.accounts, draft.accountId) { draft = draft.copy(accountId = it) }
                }
            }
            val category: @Composable (Modifier) -> Unit = { m ->
                Box(m) {
                    // The Category filter finds a main category's subcategories too, as on the web.
                    FilterBox(R.string.filter_category, R.string.filter_all_categories, R.string.filter_no_match_category, options.categories, draft.categoryId) {
                        draft = draft.copy(categoryId = it, includeSubcategories = true)
                    }
                }
            }
            val from: @Composable (Modifier) -> Unit = { m -> Box(m) { DateField(stringResource(R.string.filter_from), draft.from) { draft = draft.copy(from = it) } } }
            val to: @Composable (Modifier) -> Unit = { m -> Box(m) { DateField(stringResource(R.string.filter_to), draft.to) { draft = draft.copy(to = it) } } }
            val tag: @Composable (Modifier) -> Unit = { m ->
                Box(m) { FilterBox(R.string.filter_tag, R.string.filter_all_tags, R.string.filter_no_match_tag, options.tags, draft.tagId) { draft = draft.copy(tagId = it) } }
            }
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (twoColumns) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { account(Modifier.weight(1f)); category(Modifier.weight(1f)) }
                    tag(Modifier.fillMaxWidth())
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { from(Modifier.weight(1f)); to(Modifier.weight(1f)) }
                } else {
                    account(Modifier.fillMaxWidth()); category(Modifier.fillMaxWidth()); tag(Modifier.fillMaxWidth())
                    from(Modifier.fillMaxWidth()); to(Modifier.fillMaxWidth())
                }
            }
        }
        Text(stringResource(R.string.filter_status), style = MaterialTheme.typography.labelLarge, modifier = Modifier.semantics { heading() })
        val statuses = listOf(null to R.string.filter_status_all, "cleared" to R.string.filter_status_cleared, "pending" to R.string.filter_status_pending)
        SegmentedControl(statuses.map { stringResource(it.second) }, statuses.indexOfFirst { it.first == draft.status }, { draft = draft.copy(status = statuses[it].first) })
        if (draft.rangeInvalid) RangeInvalid()
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            SecondaryButton(stringResource(R.string.cancel), onCancel, modifier = Modifier.weight(1f))
            PrimaryButton(stringResource(R.string.filters_apply), { onApply(draft) }, modifier = Modifier.weight(1f), enabled = !draft.rangeInvalid)
        }
    }
}

/** Two fields share a row from this width, and only while the text is not enlarged. */
private val TwoColumnWidth = 340.dp

internal fun sheetTwoColumns(width: androidx.compose.ui.unit.Dp, fontScale: Float): Boolean = width >= TwoColumnWidth && fontScale <= 1.15f

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
