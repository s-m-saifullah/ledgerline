package app.ledgerline.android.ui.clients

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.mirror.MirrorReads
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.OnlineReader
import app.ledgerline.android.online.Page
import app.ledgerline.android.online.PageSize
import app.ledgerline.android.online.PagedRead
import app.ledgerline.android.online.Paged
import app.ledgerline.android.online.map
import app.ledgerline.android.online.readOnTrigger
import app.ledgerline.android.online.readings
import app.ledgerline.android.online.view
import app.ledgerline.api.Contact
import app.ledgerline.api.HistoryEvent
import app.ledgerline.api.Service
import app.ledgerline.api.ServicePayment
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Clients, read online (ADR 0043, slice 5): the list, and for the chosen client its details, services and history,
 * with a service's payments read when it is opened. Each list is read a page at a time and the screen asks for the
 * rest on its own (see `AutoLoadMore`), because the chips, the order and the totals need every client. Everything is read only while the screen
 * shows it, after every pull, and on Retry or pull to refresh; nothing is written to the phone, and nothing can be
 * changed here (that stays on the web).
 */
@OptIn(FlowPreview::class)
@HiltViewModel
class ClientsViewModel @Inject constructor(
    private val reader: OnlineReader,
    private val reads: MirrorReads,
) : ViewModel() {
    /** How long typing pauses before the search is sent; a test sets it to 0. */
    internal var searchDelayMillis = 300L

    private val retries = MutableStateFlow(0)
    private val _text = MutableStateFlow("")
    private val _filter = MutableStateFlow(ClientFilter.Open)
    private val _tab = MutableStateFlow(ClientTab.Paid)
    private val _selected = MutableStateFlow<String?>(null)
    val text: StateFlow<String> = _text.asStateFlow()

    /** Which clients the chips show; the server is always asked for all of them. */
    val filter: StateFlow<ClientFilter> = _filter.asStateFlow()

    /** Which list shows under a client's unpaid services. */
    val tab: StateFlow<ClientTab> = _tab.asStateFlow()

    /** The client being looked at, or null while the list shows. */
    val selected: StateFlow<String?> = _selected.asStateFlow()

    private val query = _text.debounce { if (it.isEmpty()) 0L else searchDelayMillis }
    private val ofClient = reads.readings(_selected.filterNotNull(), retries)

    // A search or status change is the same list: its rows stay on screen until the new first page arrives, so typing
    // does not flash a Loading card between keystrokes. Only another ledger shows Loading.
    private val list = PagedRead(viewModelScope, reads.readings(query, retries), { it.ledger }) { reading, cursor ->
        val text = reading.params
        reader.read { contacts(reading.ledger, "clients", "all", text.ifEmpty { null }, cursor, PageSize) }.map { Page(it.items, it.nextCursor) }
    }
    val clients: StateFlow<Online<Paged<Contact>>> = list.state

    val client: StateFlow<Online<Contact>> = readOnTrigger(viewModelScope, ofClient, { it.view() }) { reading ->
        reader.read { contact(reading.ledger, reading.params) }
    }

    private val servicesRead = PagedRead(viewModelScope, ofClient, { it.view() }) { reading, cursor ->
        reader.read { services(reading.ledger, reading.params, cursor, PageSize) }.map { Page(it.items, it.nextCursor) }
    }
    val services: StateFlow<Online<Paged<Service>>> = servicesRead.state

    private val historyRead = PagedRead(viewModelScope, ofClient, { it.view() }) { reading, cursor ->
        reader.read { history(reading.ledger, reading.params, cursor, PageSize) }.map { Page(it.items, it.nextCursor) }
    }
    val history: StateFlow<Online<Paged<HistoryEvent>>> = historyRead.state

    /** The payments of the services the owner opened, by service id. */
    private val _payments = MutableStateFlow<Map<String, Online<List<ServicePayment>>>>(emptyMap())
    val payments: StateFlow<Map<String, Online<List<ServicePayment>>>> = _payments.asStateFlow()

    fun search(text: String) {
        _text.value = text
    }

    fun filter(filter: ClientFilter) {
        _filter.value = filter
    }

    fun tab(tab: ClientTab) {
        _tab.value = tab
    }

    fun open(id: String) {
        _payments.value = emptyMap()
        _tab.value = ClientTab.Paid
        _selected.value = id
    }

    fun close() {
        _selected.value = null
        _payments.value = emptyMap()
    }

    fun loadMoreClients() = list.loadMore()

    fun loadMoreServices() = servicesRead.loadMore()

    fun loadMoreHistory() = historyRead.loadMore()

    /** Opens a service's payments (reading them) or closes them. */
    fun togglePayments(serviceId: String) {
        if (serviceId in _payments.value) {
            _payments.value = _payments.value - serviceId
        } else {
            readPayments(serviceId)
        }
    }

    private fun readPayments(serviceId: String) {
        // Keeps the payments already shown while they are read again; a service opened now shows Loading.
        if (_payments.value[serviceId] !is Online.Ready) _payments.value = _payments.value + (serviceId to Online.Loading)
        viewModelScope.launch {
            val ledger = reads.mirroredLedger().filterNotNull().first()
            val answer = reader.read { payments(ledger, serviceId, null, PageSize) }.map { it.items }
            // Closed while it was read: nothing to show.
            if (serviceId in _payments.value) _payments.value = _payments.value + (serviceId to answer)
        }
    }

    fun retry() {
        retries.value += 1
        _payments.value.keys.forEach(::readPayments)
    }
}
