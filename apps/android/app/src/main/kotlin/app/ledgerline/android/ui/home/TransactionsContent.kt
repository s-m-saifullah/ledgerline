package app.ledgerline.android.ui.home

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.mirror.EntryFilters
import app.ledgerline.android.mirror.EntryLine
import app.ledgerline.android.overlay.ShownLine
import app.ledgerline.android.ui.design.AmountRow
import app.ledgerline.android.ui.design.DayHeader
import app.ledgerline.android.ui.design.LedgerCard
import app.ledgerline.android.ui.design.PageHeader
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SecondaryButton
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.android.ui.theme.LocalPalette
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/** "Thu, Oct 22, 2026", as the web's day headings. */
fun dayLabel(date: String, locale: Locale = Locale.getDefault()): String =
    LocalDate.parse(date).format(DateTimeFormatter.ofPattern("EEE, MMM d, yyyy", locale))

/** Transactions as on the web (ADR 0045): grouped by day, each day one card of rows. */
@Composable
internal fun TransactionsContent(
    header: @Composable () -> Unit,
    entries: Mirrored<ShownLine>,
    canShowMore: Boolean,
    onShowMore: () -> Unit,
    filters: EntryFilters,
    options: FilterOptions,
    filtersOpen: Boolean,
    onToggleFilters: () -> Unit,
    onFilters: (EntryFilters) -> Unit,
    onOpen: (EntryLine) -> Unit,
) {
    LazyColumn(contentPadding = PaddingValues(bottom = ListBottomSpace)) {
        item {
            PageHeader(stringResource(R.string.entries_title), eyebrow = stringResource(R.string.eyebrow_ledger))
            header()
            EntryFiltersPanel(filters, options, filtersOpen, onToggleFilters, onFilters)
        }
        when (entries) {
            Mirrored.Waiting -> item { LedgerCard { Muted(stringResource(R.string.mirror_waiting)) } }
            is Mirrored.Ready -> {
                if (entries.items.isEmpty() && !filters.rangeInvalid) {
                    item {
                        LedgerCard {
                            if (filters.applied) {
                                Text(stringResource(R.string.entries_no_match_title), style = MaterialTheme.typography.titleMedium)
                                Muted(stringResource(R.string.entries_no_match))
                            } else {
                                Muted(stringResource(R.string.entries_empty))
                            }
                        }
                    }
                }
                // The list is newest first, so a day's entries are next to each other.
                val days = entries.items.groupBy { it.line.date }
                days.forEach { (date, lines) ->
                    item(key = "day-$date") { DayHeader(dayLabel(date)) }
                    item(key = "card-$date") {
                        LedgerCard(padding = PaddingValues(horizontal = 20.dp)) {
                            lines.forEachIndexed { index, shown ->
                                EntryRow(shown.line, shown.unsent, divider = index > 0) { onOpen(shown.line) }
                            }
                        }
                    }
                }
                if (canShowMore) {
                    item {
                        SecondaryButton(
                            stringResource(R.string.entries_show_more),
                            onClick = onShowMore,
                            modifier = Modifier.fillMaxWidth().padding(horizontal = ScreenMargin, vertical = 16.dp),
                        )
                    }
                }
            }
        }
    }
}

/**
 * The web's transaction row: the payee (or what it is), its category and account, its tags as pills, and the
 * amount with the kind under it; Pending and Not sent yet take the kind's place in the accent colour.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun EntryRow(entry: EntryLine, unsent: Boolean, divider: Boolean = false, onOpen: () -> Unit) {
    val title = entry.payee?.takeIf { it.isNotBlank() }
        ?: when {
            entry.kind == "transfer" -> stringResource(R.string.entry_transfer)
            entry.isSplit -> stringResource(R.string.entry_split)
            else -> entry.categoryName ?: stringResource(R.string.entry_untitled)
        }
    val category = when {
        entry.isSplit -> stringResource(R.string.entry_split)
        entry.kind == "transfer" -> stringResource(R.string.entry_transfer)
        else -> entry.categoryName
    }
    val details = listOfNotNull(category.takeIf { it != title }, entry.accountName).joinToString(" · ").ifEmpty { null }
    val amount = money(entry.amount, entry.currency)
    val kind = stringResource(
        when (entry.kind) {
            "income" -> R.string.kind_income
            "transfer" -> R.string.kind_transfer
            else -> R.string.kind_expense
        },
    )
    val flag = when {
        unsent -> stringResource(R.string.entry_not_sent)
        entry.status == "pending" -> stringResource(R.string.entry_pending)
        else -> null
    }
    val tags = entry.tagNames?.split(", ")?.filter { it.isNotBlank() }.orEmpty()
    val described = listOfNotNull(title, amount.spoken, flag ?: kind, details, dayLabel(entry.date), tags.joinToString(", ").ifEmpty { null })
        .joinToString(", ")
    AmountRow(
        title = title,
        details = listOfNotNull(details),
        amount = amount,
        under = flag ?: kind,
        underColor = if (flag != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
        described = described,
        divider = divider,
        extra = if (tags.isEmpty()) null else {
            {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    tags.forEach { Pill(it) }
                }
            }
        },
        onClick = onOpen,
    )
}

/** A tag as the web shows it: a small outlined pill. */
@Composable
private fun Pill(text: String) {
    Surface(shape = RoundedCornerShape(percent = 50), border = BorderStroke(1.dp, LocalPalette.current.fieldBorder), color = MaterialTheme.colorScheme.surface) {
        Text(text, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 10.dp, vertical = 2.dp))
    }
}
