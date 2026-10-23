package app.ledgerline.android.ui.loans

import androidx.activity.compose.BackHandler
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel

/** Loans, opened from More: the list, and a person's screen once one is chosen; Back closes the person, then returns to More. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LoansScreen(
    refreshing: Boolean,
    onRefresh: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    model: LoansViewModel = hiltViewModel(),
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
            val totals by model.totals.collectAsState()
            val text by model.text.collectAsState()
            val status by model.status.collectAsState()
            val people by model.people.collectAsState()
            LoansListContent(
                totals,
                text,
                status,
                people,
                LoansListActions(onBack, model::search, model::filter, model::open, model::loadMorePeople, model::retry),
            )
        } else {
            val person by model.person.collectAsState()
            val loans by model.loans.collectAsState()
            PersonContent(person, loans, PersonActions(model::close, model::retry, model::retry))
        }
    }
}
