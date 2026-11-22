package app.ledgerline.android.ui.clients

import androidx.activity.compose.BackHandler
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.ledgerline.android.online.Online
import app.ledgerline.android.ui.design.AutoLoadMore
import app.ledgerline.android.ui.design.OnLeaving
import java.time.LocalDate

/**
 * Clients, opened from More: the list, and a client's screen once one is chosen. The system Back gesture closes the
 * client first and then returns to More; leaving the screen closes the client too. Pulling down syncs and reads again.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClientsScreen(
    refreshing: Boolean,
    onRefresh: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    model: ClientsViewModel = hiltViewModel(),
    payment: RecordPaymentViewModel = hiltViewModel(),
    receipt: RecordReceiptViewModel = hiltViewModel(),
    logService: LogServiceViewModel = hiltViewModel(),
    deleteService: DeleteServiceViewModel = hiltViewModel(),
) {
    val selected by model.selected.collectAsStateWithLifecycle()
    OnLeaving {
        model.close()
        payment.close()
        receipt.close()
        logService.close()
        deleteService.dismiss()
    }
    // A payment went through, or the service turned out to have changed: read the client, its services and payments again.
    val reread by payment.reread.collectAsStateWithLifecycle()
    LaunchedEffect(reread) { model.rereadFor("payment", reread) }
    val receiptReread by receipt.reread.collectAsStateWithLifecycle()
    LaunchedEffect(receiptReread) { model.rereadFor("receipt", receiptReread) }
    val logged by logService.reread.collectAsStateWithLifecycle()
    LaunchedEffect(logged) { model.rereadFor("service", logged) }
    val deleted by deleteService.reread.collectAsStateWithLifecycle()
    LaunchedEffect(deleted) { model.rereadFor("delete", deleted) }
    BackHandler { if (selected != null) model.close() else onBack() }
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            onRefresh()
            model.retry()
        },
        modifier = modifier,
    ) {
        if (selected == null) {
            val text by model.text.collectAsStateWithLifecycle()
            val filter by model.filter.collectAsStateWithLifecycle()
            val clients by model.clients.collectAsStateWithLifecycle()
            AutoLoadMore(clients, model::loadMoreClients)
            ClientsListContent(
                text,
                filter,
                clients,
                ClientsListActions(onBack, model::search, model::filter, model::open, model::loadMoreClients, model::retry),
            )
        } else {
            val client by model.client.collectAsStateWithLifecycle()
            val services by model.services.collectAsStateWithLifecycle()
            val history by model.history.collectAsStateWithLifecycle()
            val payments by model.payments.collectAsStateWithLifecycle()
            val tab by model.tab.collectAsStateWithLifecycle()
            AutoLoadMore(services, model::loadMoreServices)
            AutoLoadMore(history, model::loadMoreHistory)
            ClientContent(
                client,
                services,
                history,
                payments,
                today = LocalDate.now().toString(),
                tab = tab,
                actions = ClientActions(
                    onBack = model::close,
                    onTab = model::tab,
                    onMoreServices = model::loadMoreServices,
                    onMoreHistory = model::loadMoreHistory,
                    onTogglePayments = model::togglePayments,
                    onRetryClient = model::retry,
                    onRetryServices = model::retry,
                    onRetryHistory = model::retry,
                    onRetryPayments = { model.retry() },
                    onRecordPayment = { service -> (client as? Online.Ready)?.value?.let { payment.open(service, it.name) } },
                    onRecordReceipt = { (client as? Online.Ready)?.value?.let(receipt::open) },
                    onLogService = { (client as? Online.Ready)?.value?.let(logService::open) },
                    onEditService = { service -> (client as? Online.Ready)?.value?.let { logService.openEdit(it, service) } },
                    onDeleteService = deleteService::ask,
                ),
            )
        }
    }
    val sheet by payment.sheet.collectAsStateWithLifecycle()
    sheet?.let { ui ->
        PaymentSheet(
            ui,
            PaymentActions(edit = payment::edit, save = payment::save, dismissAsk = payment::dismissAsk, confirm = payment::confirm, close = payment::close),
        )
    }
    val receiptSheet by receipt.sheet.collectAsStateWithLifecycle()
    receiptSheet?.let { ui ->
        ReceiptSheet(
            ui,
            ReceiptActions(
                edit = receipt::edit, payInFull = receipt::payInFull, chooseCurrency = receipt::chooseCurrency,
                save = receipt::save, dismissAsk = receipt::dismissAsk, confirm = receipt::confirm, close = receipt::close,
            ),
        )
    }
    val logSheet by logService.sheet.collectAsStateWithLifecycle()
    logSheet?.let { ui ->
        LogServiceSheet(ui, LogServiceActions(edit = logService::edit, save = logService::save, close = logService::close))
    }
    val deleteQuestion by deleteService.question.collectAsStateWithLifecycle()
    deleteQuestion?.let { ui -> DeleteServiceQuestion(ui, DeleteServiceActions(confirm = deleteService::confirm, dismiss = deleteService::dismiss)) }
}
