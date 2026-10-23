package app.ledgerline.android.ui.clients

import androidx.activity.compose.BackHandler
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
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
) {
    val selected by model.selected.collectAsState()
    DisposableEffect(Unit) { onDispose { model.close() } }
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
            val text by model.text.collectAsState()
            val status by model.status.collectAsState()
            val clients by model.clients.collectAsState()
            ClientsListContent(
                text,
                status,
                clients,
                ClientsListActions(onBack, model::search, model::filter, model::open, model::loadMoreClients, model::retry),
            )
        } else {
            val client by model.client.collectAsState()
            val services by model.services.collectAsState()
            val history by model.history.collectAsState()
            val payments by model.payments.collectAsState()
            ClientContent(
                client,
                services,
                history,
                payments,
                today = LocalDate.now().toString(),
                actions = ClientActions(
                    onBack = model::close,
                    onMoreServices = model::loadMoreServices,
                    onMoreHistory = model::loadMoreHistory,
                    onTogglePayments = model::togglePayments,
                    onRetryClient = model::retry,
                    onRetryServices = model::retry,
                    onRetryHistory = model::retry,
                    onRetryPayments = { model.retry() },
                ),
            )
        }
    }
}
