package app.ledgerline.android.ui.loans

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.mirror.EntryLine
import app.ledgerline.android.mirror.MirrorReads
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.OnlineReader
import app.ledgerline.android.online.Page
import app.ledgerline.android.online.Paged
import app.ledgerline.android.online.PageSize
import app.ledgerline.android.online.PagedRead
import app.ledgerline.android.online.map
import app.ledgerline.android.online.readOnTrigger
import app.ledgerline.android.online.readings
import app.ledgerline.android.online.view
import app.ledgerline.api.Contact
import app.ledgerline.api.HomeLoans
import app.ledgerline.api.LoanBalance
import app.ledgerline.api.LoanPerson
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import java.time.YearMonth
import javax.inject.Inject

/**
 * Loans, read online (ADR 0043, slice 5): every person you lend to or borrow from (the screen asks for the pages
 * one after another, see `AutoLoadMore`), with what is lent and owed in total, and for the chosen person their
 * details and loans. The search and the chips work on the phone over everyone, so the server is always asked for
 * all people. A person's latest moves come from the phone's own entries. Read only while the screen shows it, after
 * every pull and on Retry or pull to refresh; nothing is written to the phone or changed from here.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class LoansViewModel @Inject constructor(
    private val reader: OnlineReader,
    private val reads: MirrorReads,
) : ViewModel() {
    private val retries = MutableStateFlow(0)
    private val _text = MutableStateFlow("")
    private val _filter = MutableStateFlow(LoanFilter.Active)
    private val _selected = MutableStateFlow<String?>(null)
    val text: StateFlow<String> = _text.asStateFlow()

    /** Which people the chips show; the server is always asked for all of them. */
    val filter: StateFlow<LoanFilter> = _filter.asStateFlow()

    /** The person being looked at, or null while the list shows. */
    val selected: StateFlow<String?> = _selected.asStateFlow()

    private val ofPerson = reads.readings(_selected.filterNotNull(), retries)

    // A pull reloads the same list: its rows stay on screen until the new first page arrives. Only another ledger shows Loading.
    private val list = PagedRead(viewModelScope, reads.readings(flowOf("all"), retries), { it.ledger }) { reading, cursor ->
        reader.read { loanPeople(reading.ledger, reading.params, null, cursor, PageSize) }.map { Page(it.items, it.nextCursor) }
    }
    val people: StateFlow<Online<Paged<LoanPerson>>> = list.state

    /** What is lent out and owed in total this month's rates (Home's own numbers), as the web's Loans page shows. */
    val totals: StateFlow<Online<HomeLoans>> = readOnTrigger(viewModelScope, reads.readings(flowOf(YearMonth.now().toString()), retries), { it.view() }) { reading ->
        reader.read { home(reading.ledger, reading.params) }.map { it.loans }
    }

    val person: StateFlow<Online<Contact>> = readOnTrigger(viewModelScope, ofPerson, { it.view() }) { reading ->
        reader.read { contact(reading.ledger, reading.params) }
    }

    val loans: StateFlow<Online<List<LoanBalance>>> = readOnTrigger(viewModelScope, ofPerson, { it.view() }) { reading ->
        reader.read { loans(reading.ledger, reading.params) }.map { it.items }
    }

    /**
     * The newest moves on the chosen person's loan accounts, read from the phone's own entries (the accounts the
     * mirror holds for that person), so they show without a connection; empty while no person is chosen.
     */
    val movements: StateFlow<List<EntryLine>> = _selected
        .flatMapLatest { id ->
            if (id == null) {
                flowOf(emptyList())
            } else {
                reads.mirroredLedger().filterNotNull().flatMapLatest { ledger ->
                    reads.accountBalances(ledger, true).flatMapLatest { accounts ->
                        val loanAccounts = accounts.filter { it.contactId == id }.map { it.id }
                        if (loanAccounts.isEmpty()) {
                            flowOf(emptyList())
                        } else {
                            combine(loanAccounts.map { reads.filteredEntryLines(ledger, MovementLimit, it, null, false, null, null, null, null, null) }) { lists -> latestMovements(lists.toList().flatten()) }
                        }
                    }
                }
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun search(text: String) {
        _text.value = text
    }

    fun filter(filter: LoanFilter) {
        _filter.value = filter
    }

    fun open(id: String) {
        _selected.value = id
    }

    fun close() {
        _selected.value = null
    }

    fun loadMorePeople() = list.loadMore()

    fun retry() {
        retries.value += 1
    }
}
