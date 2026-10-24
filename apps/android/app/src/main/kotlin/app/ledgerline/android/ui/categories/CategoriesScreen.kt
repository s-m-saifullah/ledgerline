package app.ledgerline.android.ui.categories

import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel

/** Categories, opened from More. The system Back gesture closes an open form first, then returns to More. */
@Composable
fun CategoriesScreen(onBack: () -> Unit, bottomSpace: Dp, modifier: Modifier = Modifier, viewModel: CategoriesViewModel = hiltViewModel()) {
    val view by viewModel.view.collectAsState()
    val groups by viewModel.groups.collectAsState()
    val items by viewModel.items.collectAsState()
    BackHandler { if (view.form != null) viewModel.closeForm() else onBack() }
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
        ),
        bottomSpace = bottomSpace,
        modifier = modifier,
    )
}
