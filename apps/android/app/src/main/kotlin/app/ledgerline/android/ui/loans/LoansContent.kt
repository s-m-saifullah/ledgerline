package app.ledgerline.android.ui.loans

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.Paged
import app.ledgerline.android.ui.design.BackLink
import app.ledgerline.android.ui.design.ChoiceField
import app.ledgerline.android.ui.design.LedgerCard
import app.ledgerline.android.ui.design.LoadMore
import app.ledgerline.android.ui.design.MutedLine
import app.ledgerline.android.ui.design.PageHeader
import app.ledgerline.android.ui.design.RetryNote
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SearchField
import app.ledgerline.android.ui.design.StatCard
import app.ledgerline.android.ui.design.TitleAndAmount
import app.ledgerline.android.ui.design.tabular
import app.ledgerline.android.ui.home.ListBottomSpace
import app.ledgerline.android.ui.home.Muted
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.api.Contact
import app.ledgerline.api.HomeLoans
import app.ledgerline.api.LoanBalance
import app.ledgerline.api.LoanPerson
import kotlin.math.abs

/** What the loans list's controls do, as plain data. */
class LoansListActions(
    val onBack: () -> Unit,
    val onSearch: (String) -> Unit,
    val onFilter: (String) -> Unit,
    val onOpen: (String) -> Unit,
    val onMore: () -> Unit,
    val onRetry: () -> Unit,
)

/**
 * Loans as on the web (ADR 0045), read-only: the header, what is lent out and owed in total, a search and a
 * status, then a card per person with what they owe you or you owe them. Adding loans stays on the web.
 */
@Composable
internal fun LoansListContent(
    totals: Online<HomeLoans>,
    text: String,
    status: String,
    state: Online<Paged<LoanPerson>>,
    actions: LoansListActions,
    modifier: Modifier = Modifier,
) {
    LazyColumn(modifier = modifier, contentPadding = PaddingValues(bottom = ListBottomSpace), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            BackLink(stringResource(R.string.back_more), actions.onBack)
            PageHeader(
                stringResource(R.string.loans_title),
                eyebrow = stringResource(R.string.eyebrow_loans),
                subtitle = stringResource(R.string.loans_subtitle),
            )
        }
        if (totals is Online.Ready) {
            item { StatCard(stringResource(R.string.loans_lent), money(totals.value.lent.amount, totals.value.lent.currency), stringResource(R.string.loans_lent_detail)) }
            item { StatCard(stringResource(R.string.loans_borrowed), money(totals.value.borrowed.amount, totals.value.borrowed.currency), stringResource(R.string.loans_borrowed_detail)) }
        }
        item { SearchField(stringResource(R.string.loans_search), text, actions.onSearch) }
        item {
            ChoiceField(
                stringResource(R.string.loans_show),
                listOf(
                    "active" to stringResource(R.string.loans_active),
                    "archived" to stringResource(R.string.loans_archived),
                    "all" to stringResource(R.string.loans_everyone),
                ),
                status,
                actions.onFilter,
                modifier = Modifier.padding(horizontal = ScreenMargin),
            )
        }
        when (state) {
            Online.Loading -> item { LedgerCard { Muted(stringResource(R.string.loans_loading)) } }
            Online.Offline -> item { RetryNote(stringResource(R.string.loans_offline), actions.onRetry) }
            Online.Failed -> item { RetryNote(stringResource(R.string.loans_failed), actions.onRetry) }
            is Online.Ready -> {
                val paged = state.value
                if (paged.items.isEmpty()) {
                    item {
                        LedgerCard {
                            Text(
                                stringResource(if (text.isNotEmpty()) R.string.loans_empty_none else R.string.loans_empty_title),
                                style = MaterialTheme.typography.titleLarge,
                                modifier = Modifier.semantics { heading() },
                            )
                            Muted(stringResource(R.string.loans_empty_body))
                        }
                    }
                }
                items(paged.items, key = { it.id }) { PersonCard(it, onClick = { actions.onOpen(it.id) }) }
                if (paged.hasMore) {
                    item { LoadMore(stringResource(R.string.load_more_people), paged.loadingMore, paged.moreFailed, actions.onMore) }
                }
            }
        }
    }
}

/** What a person owes you or you owe them, per currency: "Owes you $200.00", "Settled" or "No loans yet". */
@Composable
internal fun summary(person: LoanPerson): Pair<List<String>, String> {
    if (person.balances.isEmpty()) return stringResource(R.string.loans_none).let { listOf(it) to it }
    val open = person.balances.filter { it.balance.amount != 0L }
    if (open.isEmpty()) return stringResource(R.string.loans_settled).let { listOf(it) to it }
    val lines = open.map { loan ->
        val amount = money(abs(loan.balance.amount), loan.balance.currency)
        val words = stringResource(if (loan.balance.amount > 0) R.string.loans_owes_you else R.string.loans_you_owe)
        "$words ${amount.text}" to "$words ${amount.spoken}"
    }
    return lines.map { it.first } to lines.joinToString(", ") { it.second }
}

/** `.client-card` for a person: the name and what they owe you or you owe them. */
@Composable
internal fun PersonCard(person: LoanPerson, onClick: () -> Unit) {
    val name = if (person.archivedAt != null) stringResource(R.string.client_archived, person.name) else person.name
    val (lines, spoken) = summary(person)
    LedgerCard(
        modifier = Modifier
            .clickable(onClick = onClick)
            .clearAndSetSemantics { contentDescription = "$name, $spoken" },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(name, style = MaterialTheme.typography.titleMedium)
            lines.forEach { Text(it, style = MaterialTheme.typography.bodyLarge.tabular()) }
        }
    }
}

/** What one person's screen does, as plain data. */
class PersonActions(val onBack: () -> Unit, val onRetryPerson: () -> Unit, val onRetryLoans: () -> Unit)

/** One person as on the web, read-only: their name, what they owe or you owe them per currency, and the balance from before Ledgerline. */
@Composable
internal fun PersonContent(
    person: Online<Contact>,
    loans: Online<List<LoanBalance>>,
    actions: PersonActions,
    modifier: Modifier = Modifier,
) {
    LazyColumn(modifier = modifier, contentPadding = PaddingValues(bottom = ListBottomSpace), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            BackLink(stringResource(R.string.loans_all_people), actions.onBack)
            PageHeader(
                stringResource(R.string.loans_title),
                eyebrow = stringResource(R.string.eyebrow_loans),
                subtitle = stringResource(R.string.loans_subtitle),
            )
        }
        val name = (person as? Online.Ready)?.value?.name.orEmpty()
        when (person) {
            Online.Loading -> Unit
            Online.Offline -> item { RetryNote(stringResource(R.string.loans_offline), actions.onRetryPerson) }
            Online.Failed -> item { RetryNote(stringResource(R.string.loans_person_failed), actions.onRetryPerson) }
            is Online.Ready -> item {
                val shown = if (person.value.archivedAt != null) stringResource(R.string.client_archived, person.value.name) else person.value.name
                LedgerCard { Text(shown, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() }) }
            }
        }
        item { Heading(stringResource(R.string.loans_balance_title)) }
        when (loans) {
            Online.Loading -> item { LedgerCard { Muted(stringResource(R.string.loans_loading)) } }
            Online.Offline -> item { RetryNote(stringResource(R.string.loans_offline), actions.onRetryLoans) }
            Online.Failed -> item { RetryNote(stringResource(R.string.loans_balance_failed), actions.onRetryLoans) }
            is Online.Ready -> {
                if (loans.value.isEmpty()) item { MutedLine(stringResource(R.string.loans_balance_none)) }
                if (loans.value.isNotEmpty()) item { BalanceLines(name, loans.value) }
                val before = loans.value.filter { it.openingBalance.amount != 0L }
                if (before.isNotEmpty()) {
                    item { Heading(stringResource(R.string.loans_before_title)) }
                    item { BeforeLines(before) }
                }
            }
        }
    }
}

@Composable
private fun Heading(text: String) {
    Text(text, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = ScreenMargin, end = ScreenMargin, top = 12.dp).semantics { heading() })
}

/** `.loan-row`: "Sam owes you" with the amount, or "You owe Jo", or "Settled (USD)". */
@Composable
private fun BalanceLines(name: String, loans: List<LoanBalance>) {
    LedgerCard(padding = PaddingValues(horizontal = 20.dp, vertical = 4.dp)) {
        loans.forEachIndexed { index, loan ->
            if (index > 0) HorizontalDivider(color = app.ledgerline.android.ui.theme.LocalPalette.current.border)
            val amount = loan.balance.amount
            val words = when {
                amount > 0 -> stringResource(R.string.loans_line_owes_you, name)
                amount < 0 -> stringResource(R.string.loans_line_you_owe, name)
                else -> stringResource(R.string.loans_line_settled, loan.currency)
            }
            val shown = if (amount != 0L) money(abs(amount), loan.balance.currency) else null
            LoanRow(words, shown?.text, shown?.spoken)
        }
    }
}

/** `Owed to you $X` or `You owed $X` for what stood before the owner started using Ledgerline. */
@Composable
private fun BeforeLines(loans: List<LoanBalance>) {
    LedgerCard(padding = PaddingValues(horizontal = 20.dp, vertical = 4.dp)) {
        loans.forEachIndexed { index, loan ->
            if (index > 0) HorizontalDivider(color = app.ledgerline.android.ui.theme.LocalPalette.current.border)
            val amount = money(abs(loan.openingBalance.amount), loan.openingBalance.currency)
            val id = if (loan.openingBalance.amount > 0) R.string.loans_before_owed else R.string.loans_before_owed_them
            val text = stringResource(id, amount.text)
            val spoken = stringResource(id, amount.spoken)
            Column(modifier = Modifier.padding(vertical = 14.dp).clearAndSetSemantics { contentDescription = spoken }) {
                Text(text, style = MaterialTheme.typography.bodyLarge.tabular())
            }
        }
    }
}

@Composable
private fun LoanRow(words: String, amount: String?, spoken: String?) {
    val described = listOfNotNull(words, spoken).joinToString(", ")
    Column(modifier = Modifier.padding(vertical = 14.dp).clearAndSetSemantics { contentDescription = described }) {
        if (amount == null) {
            Text(words, style = MaterialTheme.typography.bodyLarge)
        } else {
            TitleAndAmount(
                title = { Text(words, style = MaterialTheme.typography.bodyLarge) },
                amount = { Text(amount, style = MaterialTheme.typography.titleMedium.tabular(), maxLines = 1, softWrap = false) },
            )
        }
    }
}
