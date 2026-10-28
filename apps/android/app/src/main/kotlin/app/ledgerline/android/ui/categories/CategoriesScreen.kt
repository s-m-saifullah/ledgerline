package app.ledgerline.android.ui.categories

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel

/**
 * Categories, opened from More. The system Back gesture closes an open form or actions sheet first, then returns to More.
 * Pulling down syncs again (the list reads the phone's own copy, so a sync is what brings changes made elsewhere).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CategoriesScreen(
    refreshing: Boolean,
    onRefresh: () -> Unit,
    onBack: () -> Unit,
    bottomSpace: Dp,
    modifier: Modifier = Modifier,
    viewModel: CategoriesViewModel = hiltViewModel(),
) {
    val view by viewModel.view.collectAsState()
    val groups by viewModel.groups.collectAsState()
    val items by viewModel.items.collectAsState()
    BackHandler { if (view.form != null) viewModel.closeForm() else if (view.menu != null) viewModel.closeMenu() else onBack() }
    PullToRefreshBox(isRefreshing = refreshing, onRefresh = onRefresh, modifier = modifier) {
        CategoriesContent(
            view = view,
            groups = groups,
            items = items.orEmpty(),
            actions = CategoriesActions(
                onBack = onBack,
                setKind = viewModel::setKind,
                setStatus = viewModel::setStatus,
                setSearch = viewModel::setSearch,
                add = viewModel::startAdd,
                edit = viewModel::startEdit,
                askArchive = viewModel::askArchive,
                unarchive = viewModel::unarchive,
                changeForm = viewModel::edit,
                save = viewModel::save,
                closeForm = viewModel::closeForm,
                confirmArchive = viewModel::confirmArchive,
                dismissAsk = viewModel::dismissAsk,
                askDelete = viewModel::askDelete,
                confirmDelete = viewModel::confirmDelete,
                dismissDeleteAsk = viewModel::dismissDeleteAsk,
                archiveInstead = viewModel::archiveInstead,
                openMenu = viewModel::openMenu,
                closeMenu = viewModel::closeMenu,
                addUnder = viewModel::startAddUnder,
                toggleGroup = viewModel::toggleGroup,
                toggleAll = viewModel::toggleAll,
            ),
            bottomSpace = bottomSpace,
            modifier = Modifier.fillMaxSize(),
        )    }
}
