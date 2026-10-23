package app.ledgerline.android.ui.loans

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.mirror.MirrorReads
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.OnlineReader
import app.ledgerline.android.online.Page
import app.ledgerline.android.online.Paged
import app.ledgerline.android.online.PagedRead
import app.ledgerline.android.online.map
import app.ledgerline.android.online.readOnTrigger
import app.ledgerline.android.online.readings
import app.ledgerline.android.online.view
import app.ledgerline.android.ui.clients.ClientsQuery
import app.ledgerline.android.ui.clients.PageSize
import app.ledgerline.api.Contact
import app.ledgerline.api.HomeLoans
import app.ledgerline.api.LoanBalance
import app.ledgerline.api.LoanPerson
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.flowOf
import java.time.YearMonth
import javax.inject.Inject

/**
 * Loans, read online (ADR 0043, slice 5): the people you lend to or borrow from a page at a time, with what is
 * lent and owed in total, and for the chosen person their details and loans. Read only while the screen shows it,
 * after every pull and on Retry or pull to refresh; nothing is written to the phone or changed from here.
 */
@OptIn(FlowPreview::class)
@HiltViewModel
class LoansViewModel @Inject constructor(
    private val reader: OnlineReader,
    reads: MirrorReads,
) : ViewModel() {
    /** How long typing pauses before the search is sent; a test sets it to 0. */
    internal var searchDelayMillis = 300L

    private val retries = MutableStateFlow(0)
    private val _text = MutableStateFlow("")
    private val _status = MutableStateFlow("active")
    private val _selected = MutableStateFlow<String?>(null)
    val text: StateFlow<String> = _text.asStateFlow()
    val status: StateFlow<String> = _status.asStateFlow()

    /** The person being looked at, or null while the list shows. */
    val selected: StateFlow<String?> = _selected.asStateFlow()

    private val query = combine(_text.debounce { if (it.isEmpty()) 0L else searchDelayMillis }, _status, ::ClientsQuery)
    private val ofPerson = reads.readings(_selected.filterNotNull(), retries)

    private val list = PagedRead(viewModelScope, reads.readings(query, retries), { it.view() }) { reading, cursor ->
        val (text, status) = reading.params
        reader.read { loanPeople(reading.ledger, status, text.ifEmpty { null }, cursor, PageSize) }.map { Page(it.items, it.nextCursor) }
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

    fun search(text: String) {
        _text.value = text
    }

    fun filter(status: String) {
        _status.value = status
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
