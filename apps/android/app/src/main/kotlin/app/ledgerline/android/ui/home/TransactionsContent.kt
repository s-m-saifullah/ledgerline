package app.ledgerline.android.ui.home

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.mirror.EntryFilters
import app.ledgerline.android.mirror.EntryLine
import app.ledgerline.android.overlay.ShownLine
import app.ledgerline.android.ui.design.Avatar
import app.ledgerline.android.ui.design.CardGap
import app.ledgerline.android.ui.design.DayHeader
import app.ledgerline.android.ui.design.GroupedListCard
import app.ledgerline.android.ui.design.IconAvatar
import app.ledgerline.android.ui.design.LedgerCard
import app.ledgerline.android.ui.design.ListRow
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SecondaryButton
import app.ledgerline.android.ui.design.TopBar
import app.ledgerline.android.ui.design.narrowingRoom
import app.ledgerline.android.ui.design.tabular
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.android.ui.theme.LocalPalette
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/** "Thu, Oct 22, 2026", as the web's day headings. */
fun dayLabel(date: String, locale: Locale = Locale.getDefault()): String =
    LocalDate.parse(date).format(DateTimeFormatter.ofPattern("EEE, MMM d, yyyy", locale))

/**
 * Transactions (ADR 0046): a fixed top bar, the sync state, what needs the owner, the search box with the type
 * chips and the Filters chip (its sheet opens over the list), then the days, each one grouped card of rows with the
 * day's net in its heading.
 */
@Composable
internal fun TransactionsContent(
    status: SyncStatus,
    entries: Mirrored<ShownLine>,
    canShowMore: Boolean,
    onShowMore: () -> Unit,
    filters: EntryFilters,
    options: FilterOptions,
    filtersOpen: Boolean,
    onToggleFilters: () -> Unit,
    onFilters: (EntryFilters) -> Unit,
    onRetrySync: () -> Unit,
    onOpenAttention: () -> Unit,
    modifier: Modifier = Modifier,
    onOpen: (EntryLine) -> Unit,
) {
    Column(modifier) {
        TopBar(stringResource(R.string.entries_title))
        LazyColumn(contentPadding = PaddingValues(bottom = ListBottomSpace), verticalArrangement = Arrangement.spacedBy(CardGap)) {
            item { SyncStatusRow(status, onRetrySync) }
            if (status.attention > 0) {
                item { Note(pluralStringResource(R.plurals.attention_banner, status.attention, status.attention), onOpenAttention) }
            }
            item { EntryFilterBar(filters, onFilters, onToggleFilters) }
            when (entries) {
                Mirrored.Waiting -> item { LedgerCard { Muted(stringResource(R.string.mirror_waiting)) } }
                is Mirrored.Ready -> {
                    if (entries.items.isEmpty() && !filters.rangeInvalid) {
                        item {
                            LedgerCard {
                                if (filters.applied) {
                                    Text(stringResource(R.string.entries_no_match_title), style = MaterialTheme.typography.titleMedium)
                                    Muted(stringResource(R.string.entries_no_match))
                                    SecondaryButton(stringResource(R.string.filters_clear), { onFilters(EntryFilters()) }, modifier = Modifier.padding(top = 12.dp))
                                } else {
                                    Muted(stringResource(R.string.entries_empty))
                                }
                            }
                        }
                    }
                    // The list is newest first, so a day's entries are next to each other.
                    groupDays(entries.items).forEach { day ->
                        item(key = "day-${day.date}") {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                DayHeader(dayLabel(day.date), day.nets.map { money(it.amount, it.currency).text }.joinToString(" · ").ifEmpty { null })
                                GroupedListCard {
                                    day.rows.forEach { model ->
                                        row {
                                            when (model) {
                                                is EntryRowModel.Single -> EntryRow(model.shown.line, model.shown.unsent) { onOpen(model.shown.line) }
                                                is EntryRowModel.Transfer -> TransferRow(model) { onOpen(model.out.line) }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if (canShowMore) {
                        item {
                            SecondaryButton(
                                stringResource(R.string.entries_show_more),
                                onClick = onShowMore,
                                modifier = Modifier.fillMaxWidth().padding(horizontal = ScreenMargin),
                            )
                        }
                    }
                }
            }
            // Room so that filtering while scrolled never pulls the list (and the search box) back (CONTRIBUTING.md).
            narrowingRoom(filters.applied)
        }
    }
    if (filtersOpen) EntryFiltersSheet(filters, options, onFilters, onToggleFilters)
}

/** The word under an amount when the entry is not settled: Not sent yet, or Pending; null otherwise. */
@Composable
private fun flagOf(unsent: Boolean, status: String): String? = when {
    unsent -> stringResource(R.string.entry_not_sent)
    status == "pending" -> stringResource(R.string.entry_pending)
    else -> null
}

/** What sits at the right of a row: the amount, and under it the flag in the accent colour while there is one. */
@Composable
private fun AmountAndFlag(amount: String, flag: String?) {
    Column(horizontalAlignment = Alignment.End) {
        Text(amount, style = MaterialTheme.typography.titleMedium.tabular(), maxLines = 1, softWrap = false)
        if (flag != null) Text(flag, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
    }
}

/**
 * An entry: its first letters, the payee (or what it is), its category and account, its tags as pills, and the
 * amount with Pending or Not sent yet under it. The kind is in the amount's sign and in what a screen reader says.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun EntryRow(entry: EntryLine, unsent: Boolean, onOpen: () -> Unit) {
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
    val flag = flagOf(unsent, entry.status)
    val tags = entry.tagNames?.split(", ")?.filter { it.isNotBlank() }.orEmpty()
    val described = listOfNotNull(title, amount.spoken, flag ?: kind, details, dayLabel(entry.date), tags.joinToString(", ").ifEmpty { null })
        .joinToString(", ")
    ListRow(
        title = title,
        subtitle = details,
        leading = { if (entry.kind == "transfer") IconAvatar(R.drawable.ic_entries) else Avatar(title) },
        trailing = { AmountAndFlag(amount.text, flag) },
        onClick = onOpen,
        described = described,
        extra = if (tags.isEmpty()) null else {
            {
                FlowRow(modifier = Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    tags.forEach { Pill(it) }
                }
            }
        },
    )
}

/** A plain transfer as one row: "From → To", the amount that moved, and a flag if either leg is not settled. */
@Composable
internal fun TransferRow(transfer: EntryRowModel.Transfer, onOpen: () -> Unit) {
    val out = transfer.out.line
    val into = transfer.into.line
    val title = stringResource(R.string.transfer_title, out.accountName.orEmpty(), into.accountName.orEmpty())
    val amount = money(-out.amount, out.currency)
    val flag = flagOf(transfer.out.unsent || transfer.into.unsent, if (out.status == "pending" || into.status == "pending") "pending" else "cleared")
    val described = listOfNotNull(title, amount.spoken, flag ?: stringResource(R.string.kind_transfer), dayLabel(out.date)).joinToString(", ")
    ListRow(
        title = title,
        subtitle = stringResource(R.string.entry_transfer),
        leading = { IconAvatar(R.drawable.ic_entries) },
        trailing = { AmountAndFlag(amount.text, flag) },
        onClick = onOpen,
        described = described,
    )
}

/** A tag as the web shows it: a small outlined pill. */
@Composable
private fun Pill(text: String) {
    Surface(shape = RoundedCornerShape(percent = 50), border = BorderStroke(1.dp, LocalPalette.current.fieldBorder), color = MaterialTheme.colorScheme.surface) {
        Text(text, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 10.dp, vertical = 2.dp))
    }
}
