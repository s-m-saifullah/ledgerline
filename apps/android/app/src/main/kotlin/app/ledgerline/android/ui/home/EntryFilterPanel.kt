package app.ledgerline.android.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.mirror.EntryFilters
import app.ledgerline.android.ui.design.FilterChip
import app.ledgerline.android.ui.design.FiltersButton
import app.ledgerline.android.ui.design.SegmentedControl
import app.ledgerline.android.ui.design.SearchBox
import app.ledgerline.android.ui.design.LinkButton
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.Choice
import app.ledgerline.android.ui.design.DatePickerStep
import app.ledgerline.android.ui.design.LedgerSheet
import app.ledgerline.android.ui.design.RowHeight
import app.ledgerline.android.ui.design.SheetTitle
import app.ledgerline.android.ui.design.ValuePill
import app.ledgerline.android.ui.editor.ComboField
import app.ledgerline.android.ui.format.formatEntryDate
import app.ledgerline.android.ui.theme.LocalPalette
import java.time.LocalDate

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
        // One row, one height: the button stretches to the box if large text makes the box taller.
        Row(modifier = Modifier.padding(horizontal = ScreenMargin).height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            SearchBox(stringResource(R.string.filters_search), filters.text, { onChange(filters.copy(text = it)) }, Modifier.weight(1f))
            FiltersButton(filters.sheetCount, onOpenFilters, Modifier.fillMaxHeight())
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

/**
 * The Filters sheet (ADR 0046, amended 2026-11-20): every choice takes effect at once, as on the web, so the list behind the
 * sheet follows; Close shuts it. There is no Apply: nothing is pending, so there is nothing to cancel.
 */
@Composable
internal fun EntryFiltersSheet(filters: EntryFilters, options: FilterOptions, onChange: (EntryFilters) -> Unit, onDismiss: () -> Unit) {
    LedgerSheet(onDismiss) { EntryFiltersSheetContent(filters, options, onChange, onDismiss) }
}

/**
 * What the sheet holds, apart from the sheet itself, so it can be tested and photographed: the title with Reset all (while
 * any sheet filter is set) and Close, the account and category, the tag, the From and To dates as pills (two fields to a row
 * where the width allows), and the status. Each change is reported at once through [onChange].
 */
@Composable
internal fun EntryFiltersSheetContent(filters: EntryFilters, options: FilterOptions, onChange: (EntryFilters) -> Unit, onClose: () -> Unit) {
    Column(
        modifier = Modifier.verticalScroll(rememberScrollState()).padding(horizontal = ScreenMargin).padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SheetTitle(
            stringResource(R.string.filters_chip),
            onClose,
            cancelLabel = stringResource(R.string.close),
            action = if (filters.sheetCount > 0) {
                {
                    LinkButton(stringResource(R.string.filters_reset), {
                        onChange(filters.copy(accountId = null, categoryId = null, tagId = null, from = null, to = null, status = null))
                    })
                }
            } else {
                null
            },
        )
        BoxWithConstraints {
            val twoColumns = sheetTwoColumns(maxWidth, LocalDensity.current.fontScale)
            val account: @Composable (Modifier) -> Unit = { m ->
                Box(m) {
                    FilterBox(R.string.filter_account, R.string.filter_all_accounts, R.string.filter_no_match_account, options.accounts, filters.accountId) { onChange(filters.copy(accountId = it)) }
                }
            }
            val category: @Composable (Modifier) -> Unit = { m ->
                Box(m) {
                    // The Category filter finds a main category's subcategories too, as on the web.
                    FilterBox(R.string.filter_category, R.string.filter_all_categories, R.string.filter_no_match_category, options.categories, filters.categoryId) {
                        onChange(filters.copy(categoryId = it, includeSubcategories = true))
                    }
                }
            }
            val tag: @Composable (Modifier) -> Unit = { m ->
                Box(m) { FilterBox(R.string.filter_tag, R.string.filter_all_tags, R.string.filter_no_match_tag, options.tags, filters.tagId) { onChange(filters.copy(tagId = it)) } }
            }
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (twoColumns) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { account(Modifier.weight(1f)); category(Modifier.weight(1f)) }
                    tag(Modifier.fillMaxWidth())
                } else {
                    account(Modifier.fillMaxWidth()); category(Modifier.fillMaxWidth()); tag(Modifier.fillMaxWidth())
                }
            }
        }
        Column {
            DateFilterRow(stringResource(R.string.filter_from), filters.from) { onChange(filters.copy(from = it)) }
            DateFilterRow(stringResource(R.string.filter_to), filters.to) { onChange(filters.copy(to = it)) }
        }
        Text(stringResource(R.string.filter_status), style = MaterialTheme.typography.labelLarge, modifier = Modifier.semantics { heading() })
        val statuses = listOf(null to R.string.filter_status_all, "cleared" to R.string.filter_status_cleared, "pending" to R.string.filter_status_pending)
        SegmentedControl(statuses.map { stringResource(it.second) }, statuses.indexOfFirst { it.first == filters.status }, { onChange(filters.copy(status = statuses[it].first)) })
        if (filters.rangeInvalid) RangeInvalid()
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

/**
 * A date filter: its name and a pill that shows the day (a cross inside it clears it) or "Any date" (dashed). A tap opens the
 * same date picker every other sheet uses, which starts on today while there is no day.
 */
@Composable
internal fun DateFilterRow(label: String, value: String?, onChange: (String?) -> Unit) {
    var picking by rememberSaveable { mutableStateOf(false) }
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = RowHeight),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = LocalPalette.current.muted)
        Row(modifier = Modifier.weight(1f), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
            if (value != null) {
                ValuePill(runCatching { formatEntryDate(value) }.getOrDefault(value), { picking = true }, onClear = { onChange(null) }, clearLabel = stringResource(R.string.filter_clear_date, label))
            } else {
                ValuePill(stringResource(R.string.filter_any_date), { picking = true }, dashed = true)
            }
        }
    }
    if (picking) DatePickerStep(value ?: LocalDate.now().toString(), onPick = { onChange(it) }, onClose = { picking = false })
}
