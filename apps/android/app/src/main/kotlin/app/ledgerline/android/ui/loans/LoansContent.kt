package app.ledgerline.android.ui.loans

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.mirror.EntryLine
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.Paged
import app.ledgerline.android.ui.design.Avatar
import app.ledgerline.android.ui.design.CardGap
import app.ledgerline.android.ui.design.EmptyState
import app.ledgerline.android.ui.design.FilterChip
import app.ledgerline.android.ui.design.GroupedListCard
import app.ledgerline.android.ui.design.LedgerCard
import app.ledgerline.android.ui.design.ListRow
import app.ledgerline.android.ui.design.LoadMore
import app.ledgerline.android.ui.design.RetryNote
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SearchBox
import app.ledgerline.android.ui.design.SectionLabel
import app.ledgerline.android.ui.design.TopBar
import app.ledgerline.android.ui.design.tabular
import app.ledgerline.android.ui.format.formatEntryDate
import app.ledgerline.android.ui.home.ListBottomSpace
import app.ledgerline.android.ui.home.Muted
import app.ledgerline.android.ui.home.withPlus
import app.ledgerline.android.ui.privacy.LocalPrivacy
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.android.ui.theme.LocalPalette
import app.ledgerline.api.Contact
import app.ledgerline.api.HomeLoans
import app.ledgerline.api.LoanBalance
import app.ledgerline.api.LoanPerson
import kotlin.math.abs

/** What the people list's controls show and do, as plain data. */
class LoansListActions(
    val onBack: () -> Unit,
    val onSearch: (String) -> Unit,
    val onFilter: (LoanFilter) -> Unit,
    val onOpen: (String) -> Unit,
    val onMore: () -> Unit,
    val onRetry: () -> Unit,
)

/**
 * Loans (ADR 0046), read-only: a fixed top bar with the search box (only with eight or more people) and the Active,
 * Archived and All chips (only while someone is archived) under it, then, scrolling, one card with what is lent out
 * and what is owed, and one grouped card of people. Adding loans stays on the web (ADR 0043).
 */
@Composable
internal fun LoansListContent(
    totals: Online<HomeLoans>,
    text: String,
    filter: LoanFilter,
    state: Online<Paged<LoanPerson>>,
    actions: LoansListActions,
    modifier: Modifier = Modifier,
) {
    Column(modifier) {
        TopBar(stringResource(R.string.loans_title), onBack = actions.onBack)
        val loaded = (state as? Online.Ready)?.value?.items.orEmpty()
        val chips = showChips(loaded)
        val shown = if (chips) filter else LoanFilter.Active
        if (showSearch(loaded) || chips) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (showSearch(loaded)) SearchBox(stringResource(R.string.loans_search), text, actions.onSearch, Modifier.padding(horizontal = ScreenMargin))
                if (chips) {
                    Row(modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = ScreenMargin), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(stringResource(R.string.loans_chip_active), shown == LoanFilter.Active) { actions.onFilter(LoanFilter.Active) }
                        FilterChip(stringResource(R.string.loans_chip_archived), shown == LoanFilter.Archived) { actions.onFilter(LoanFilter.Archived) }
                        FilterChip(stringResource(R.string.loans_chip_all), shown == LoanFilter.All) { actions.onFilter(LoanFilter.All) }
                    }
                }
            }
        }
        LazyColumn(contentPadding = PaddingValues(top = CardGap, bottom = ListBottomSpace), verticalArrangement = Arrangement.spacedBy(CardGap)) {
            if (totals is Online.Ready) item { SummaryCard(totals.value, loaded) }
            when (state) {
                Online.Loading -> item { LedgerCard { Muted(stringResource(R.string.loans_loading)) } }
                Online.Offline -> item { RetryNote(stringResource(R.string.loans_offline), actions.onRetry) }
                Online.Failed -> item { RetryNote(stringResource(R.string.loans_failed), actions.onRetry) }
                is Online.Ready -> peopleItems(state.value, text, shown, actions)
            }
        }
    }
}

private fun LazyListScope.peopleItems(paged: Paged<LoanPerson>, text: String, filter: LoanFilter, actions: LoansListActions) {
    val people = visiblePeople(paged.items, filter, text)
    if (people.isEmpty()) {
        item {
            EmptyState(
                stringResource(
                    when {
                        text.isNotBlank() && showSearch(paged.items) -> R.string.loans_empty_none
                        paged.items.isEmpty() -> R.string.loans_empty
                        filter == LoanFilter.Archived -> R.string.loans_no_archived
                        else -> R.string.loans_empty
                    },
                ),
            )
        }
    } else {
        item { GroupedListCard { people.forEach { person -> row { PersonRow(person) { actions.onOpen(person.id) } } } } }
    }
    if (paged.hasMore) {
        item { LoadMore(stringResource(R.string.load_more_people), paged.loadingMore, paged.moreFailed, actions.onMore) }
    }
}

/**
 * What is lent out (and how many people owe you) beside what you owe (or that you are debt-free), from Home's own
 * figures, so the card agrees with Home; the counts come from the people read. The two sit side by side when there
 * is room (see [summaryInColumns]) and one above the other when not; a debt of nothing is muted.
 */
@Composable
private fun SummaryCard(totals: HomeLoans, people: List<LoanPerson>) {
    val palette = LocalPalette.current
    val lent = money(totals.lent.amount, totals.lent.currency)
    val borrowed = money(totals.borrowed.amount, totals.borrowed.currency)
    val owed = owesYouCount(people)
    val owing = youOweCount(people)
    val lentLabel = stringResource(R.string.loans_lent)
    val borrowedLabel = stringResource(R.string.loans_borrowed)
    val owedHint = if (owed > 0) pluralStringResource(R.plurals.loans_owe_you_count, owed, owed) else null
    val debtFree = totals.borrowed.amount <= 0
    val owingHint = when {
        debtFree -> stringResource(R.string.loans_debt_free)
        owing > 0 -> pluralStringResource(R.plurals.loans_you_owe_count, owing, owing)
        else -> null
    }
    val spoken = listOfNotNull(lentLabel, lent.spoken, owedHint, borrowedLabel, borrowed.spoken, owingHint).joinToString(", ")
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    LedgerCard(
        modifier = if (LocalPrivacy.current) Modifier.clearAndSetSemantics { contentDescription = spoken } else Modifier,
        padding = PaddingValues(16.dp),
    ) {
        BoxWithConstraints {
            val side = summaryInColumns(maxWidth.value, LocalDensity.current.fontScale, maxOf(lent.text.length, borrowed.text.length))
            val left = @Composable { modifier: Modifier ->
                SummaryBlock(lentLabel, lent.text, owedHint, palette.accent, MaterialTheme.colorScheme.onSurface, muted, modifier)
            }
            val right = @Composable { modifier: Modifier ->
                SummaryBlock(
                    borrowedLabel, borrowed.text, owingHint?.let { if (debtFree) "✓ $it" else it },
                    muted, if (debtFree) muted else MaterialTheme.colorScheme.onSurface, if (debtFree) palette.accent else muted, modifier,
                )
            }
            if (side) {
                Row(modifier = Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    left(Modifier.weight(1f))
                    Box(modifier = Modifier.width(1.dp).fillMaxHeight().background(palette.border))
                    right(Modifier.weight(1f))
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    left(Modifier)
                    right(Modifier)
                }
            }
        }
    }
}

/** A capital label, an amount, and a hint under it. */
@Composable
private fun SummaryBlock(label: String, amount: String, hint: String?, labelColor: Color, amountColor: Color, hintColor: Color, modifier: Modifier) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label.uppercase(), style = MaterialTheme.typography.labelSmall, color = labelColor, maxLines = 2)
        Text(amount, style = MaterialTheme.typography.displaySmall.tabular(), color = amountColor, maxLines = 1, softWrap = false)
        if (hint != null) Text(hint, style = MaterialTheme.typography.bodySmall, color = hintColor)
    }
}

@Composable
private fun standingWord(standing: LoanStanding): String = stringResource(
    when (standing) {
        LoanStanding.OwesYou -> R.string.loans_owes_you
        LoanStanding.YouOwe -> R.string.loans_you_owe
        LoanStanding.Both -> R.string.loans_standing_both
        LoanStanding.Settled -> R.string.loans_settled
        LoanStanding.None -> R.string.loans_none
    },
)

/** A person: their initials, the name with how they stand (one word), and what is left on each loan. */
@Composable
internal fun PersonRow(person: LoanPerson, onClick: () -> Unit) {
    val name = if (person.archivedAt != null) stringResource(R.string.client_archived, person.name) else person.name
    val standing = standing(person)
    val hint = standingWord(standing)
    val open = person.balances.filter { it.balance.amount != 0L }
    // One direction needs no sign (the hint says it); mixed currencies keep theirs. What is owed to you is in the accent colour.
    val amounts = open.map { loan ->
        val shown = if (standing == LoanStanding.Both) money(loan.balance.amount, loan.balance.currency).withPlus(loan.balance.amount) else money(abs(loan.balance.amount), loan.balance.currency)
        shown to isOwedToYou(loan)
    }
    ListRow(
        title = name,
        subtitle = hint,
        leading = { Avatar(person.name) },
        trailing = if (amounts.isNotEmpty()) {
            {
                Column(horizontalAlignment = Alignment.End) {
                    amounts.forEach { (amount, owedToYou) ->
                        Text(amount.text, style = MaterialTheme.typography.titleMedium.tabular(), color = if (owedToYou) MaterialTheme.colorScheme.primary else Color.Unspecified, maxLines = 1, softWrap = false)
                    }
                }
            }
        } else {
            null
        },
        onClick = onClick,
        described = if (LocalPrivacy.current) listOf(name, hint, amounts.joinToString(", ") { it.first.spoken }).filter { it.isNotEmpty() }.joinToString(", ") else null,
    )
}

/** What one person's screen does, as plain data. */
class PersonActions(val onBack: () -> Unit, val onRetryPerson: () -> Unit, val onRetryLoans: () -> Unit)

/**
 * One person (ADR 0046), read-only: a top bar with their name, a balance card (what they owe you or you owe them,
 * once per currency), then History: the latest moves on their loan accounts, from the phone's own entries, and the
 * balance from before Ledgerline as the last line. Lending and repaying stay on the web.
 */
@Composable
internal fun PersonContent(
    person: Online<Contact>,
    loans: Online<List<LoanBalance>>,
    movements: List<EntryLine>,
    actions: PersonActions,
    modifier: Modifier = Modifier,
) {
    Column(modifier) {
        val name = (person as? Online.Ready)?.value?.let { if (it.archivedAt != null) stringResource(R.string.client_archived, it.name) else it.name }
        TopBar(name ?: stringResource(R.string.loans_title), onBack = actions.onBack)
        LazyColumn(contentPadding = PaddingValues(top = CardGap, bottom = ListBottomSpace), verticalArrangement = Arrangement.spacedBy(CardGap)) {
            when (person) {
                Online.Loading -> Unit
                Online.Offline -> item { RetryNote(stringResource(R.string.loans_offline), actions.onRetryPerson) }
                Online.Failed -> item { RetryNote(stringResource(R.string.loans_person_failed), actions.onRetryPerson) }
                is Online.Ready -> Unit
            }
            when (loans) {
                Online.Loading -> item { LedgerCard { Muted(stringResource(R.string.loans_loading)) } }
                Online.Offline -> item { RetryNote(stringResource(R.string.loans_offline), actions.onRetryLoans) }
                Online.Failed -> item { RetryNote(stringResource(R.string.loans_balance_failed), actions.onRetryLoans) }
                is Online.Ready -> {
                    if (loans.value.isEmpty()) item { EmptyState(stringResource(R.string.loans_nothing)) } else item { BalanceCard(loans.value) }
                }
            }
            val opening = (loans as? Online.Ready)?.value.orEmpty().filter { it.openingBalance.amount != 0L }
            val latest = latestMovements(movements)
            if (latest.isNotEmpty() || opening.isNotEmpty()) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        SectionLabel(stringResource(R.string.loans_history))
                        GroupedListCard {
                            latest.forEach { line -> row { MovementRow(line) } }
                            opening.forEach { loan -> row { OpeningRow(loan) } }
                        }
                    }
                }
            }
        }
    }
}

/** What they owe you, or you owe them, once per currency: the word, then the amount large (or Settled for a currency at nothing). */
@Composable
private fun BalanceCard(loans: List<LoanBalance>) {
    val lines = loans.map { loan ->
        val amount = loan.balance.amount
        val label = when {
            amount > 0 -> stringResource(R.string.loans_owes_you)
            amount < 0 -> stringResource(R.string.loans_you_owe)
            else -> stringResource(R.string.loans_line_settled, loan.currency)
        }
        val shown = if (amount != 0L) money(abs(amount), loan.balance.currency) else null
        Triple(label, shown, isOwedToYou(loan))
    }
    val spoken = lines.joinToString(", ") { (label, shown, _) -> listOfNotNull(label, shown?.spoken).joinToString(" ") }
    LedgerCard(
        modifier = if (LocalPrivacy.current) Modifier.clearAndSetSemantics { contentDescription = spoken } else Modifier,
        padding = PaddingValues(16.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            lines.forEach { (label, shown, owedToYou) ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (shown != null) {
                        Text(
                            shown.text,
                            style = MaterialTheme.typography.displaySmall.tabular(),
                            color = if (owedToYou) MaterialTheme.colorScheme.primary else Color.Unspecified,
                            maxLines = 1,
                            softWrap = false,
                        )
                    }
                }
            }
        }
    }
}

/** One move on a loan account: Sent (money out to them) or Received (money in from them), when, and with whom or what for. */
@Composable
private fun MovementRow(line: EntryLine) {
    val sent = isSent(line)
    val title = stringResource(if (sent) R.string.loans_sent else R.string.loans_received)
    val hint = listOfNotNull(line.payee?.takeIf { it.isNotBlank() } ?: line.note?.takeIf { it.isNotBlank() }, formatEntryDate(line.date)).joinToString(" · ")
    val amount = money(line.amount, line.currency).withPlus(line.amount)
    ListRow(
        title = title,
        subtitle = hint,
        trailing = { Text(amount.text, style = MaterialTheme.typography.titleMedium.tabular(), maxLines = 1, softWrap = false) },
        described = if (LocalPrivacy.current) listOf(title, amount.spoken, hint).joinToString(", ") else null,
    )
}

/** The balance from before Ledgerline: what was owed to you (plus) or what you owed (minus) when you started. */
@Composable
private fun OpeningRow(loan: LoanBalance) {
    val title = stringResource(R.string.loans_opening)
    val hint = stringResource(R.string.loans_before_hint)
    val amount = money(loan.openingBalance.amount, loan.openingBalance.currency).withPlus(loan.openingBalance.amount)
    ListRow(
        title = title,
        subtitle = hint,
        trailing = { Text(amount.text, style = MaterialTheme.typography.titleMedium.tabular(), maxLines = 1, softWrap = false) },
        described = if (LocalPrivacy.current) listOf(title, amount.spoken, hint).joinToString(", ") else null,
    )
}
