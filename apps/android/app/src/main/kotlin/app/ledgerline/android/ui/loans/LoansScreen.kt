package app.ledgerline.android.ui.loans

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

/**
 * Loans, opened from More: the list, and a person's screen once one is chosen; Back closes the person, then returns to More.
 * On a person's screen the card lends, borrows and records repayments (ADR 0050, slice 6); a move that went through, or a
 * loan that turned out to have changed, reads the person again.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LoansScreen(
    refreshing: Boolean,
    onRefresh: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    model: LoansViewModel = hiltViewModel(),
    move: RecordLoanViewModel = hiltViewModel(),
) {
    val selected by model.selected.collectAsStateWithLifecycle()
    OnLeaving {
        model.close()
        move.close()
    }
    // A move went through, or the loan turned out to have changed: read the person and their loans again.
    val moved by move.reread.collectAsStateWithLifecycle()
    LaunchedEffect(moved) { model.rereadFor(moved) }
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
            val totals by model.totals.collectAsStateWithLifecycle()
            val text by model.text.collectAsStateWithLifecycle()
            val filter by model.filter.collectAsStateWithLifecycle()
            val people by model.people.collectAsStateWithLifecycle()
            AutoLoadMore(people, model::loadMorePeople)
            LoansListContent(
                totals,
                text,
                filter,
                people,
                LoansListActions(onBack, model::search, model::filter, model::open, model::loadMorePeople, model::retry),
            )
        } else {
            val person by model.person.collectAsStateWithLifecycle()
            val loans by model.loans.collectAsStateWithLifecycle()
            val movements by model.movements.collectAsStateWithLifecycle()
            // Nothing opens for an archived person, or until both the person and the loans are read.
            fun open(kind: LoanKind) {
                val who = (person as? Online.Ready)?.value ?: return
                val open = (loans as? Online.Ready)?.value ?: return
                if (who.archivedAt == null) move.open(LoanWho(who.id, who.name), open, kind)
            }
            PersonContent(
                person, loans, movements,
                PersonActions(
                    model::close, model::retry, model::retry,
                    onRepay = { open(LoanKind.Repay) }, onLend = { open(LoanKind.Lend) }, onBorrow = { open(LoanKind.Borrow) },
                ),
            )
        }
    }
    val sheet by move.sheet.collectAsStateWithLifecycle()
    sheet?.let { ui ->
        LoanSheet(ui, LoanActions(edit = move::edit, save = move::save, dismissAsk = move::dismissAsk, confirm = move::confirm, close = move::close))
    }
}
