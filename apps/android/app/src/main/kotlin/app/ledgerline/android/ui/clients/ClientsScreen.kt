package app.ledgerline.android.ui.clients

import androidx.activity.compose.BackHandler
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.Paged
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
            val filter by model.filter.collectAsState()
            val clients by model.clients.collectAsState()
            AutoLoadMore(clients, model::loadMoreClients)
            ClientsListContent(
                text,
                filter,
                clients,
                ClientsListActions(onBack, model::search, model::filter, model::open, model::loadMoreClients, model::retry),
            )
        } else {
            val client by model.client.collectAsState()
            val services by model.services.collectAsState()
            val history by model.history.collectAsState()
            val payments by model.payments.collectAsState()
            val tab by model.tab.collectAsState()
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
                ),
            )
        }
    }
}

/**
 * Asks for the next page as soon as the one shown has arrived, until there is none or [AutoLoadCap] rows are shown, so
 * the owner never has to press Load more for a list that is a few dozen rows long. Runs only while the screen shows
 * the list, which keeps the view model's rule that nothing is read for a screen that is not on show; a failed page
 * stops it (the list's own Load more button retries).
 */
@Composable
internal fun <T> AutoLoadMore(state: Online<Paged<T>>, loadMore: () -> Unit) {
    val ready = (state as? Online.Ready)?.value
    LaunchedEffect(ready) {
        if (ready != null && ready.hasMore && !ready.loadingMore && !ready.moreFailed && ready.items.size < AutoLoadCap) loadMore()
    }
}
