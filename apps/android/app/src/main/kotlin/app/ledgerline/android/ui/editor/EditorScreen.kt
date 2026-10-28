package app.ledgerline.android.ui.editor

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import app.ledgerline.android.R

/** Add, edit or delete an entry or a transfer. Saving works offline: the change waits in the outbox until sent. */
@Composable
fun EditorScreen(target: EditorTarget, session: String, onClose: () -> Unit, viewModel: EditorViewModel = hiltViewModel(key = "editor")) {
    LaunchedEffect(session) { viewModel.open(target, session) }
    val latest by viewModel.state.collectAsState()
    // Only this opening's state counts: the view model may still hold the last opening's (for example a finished save).
    val state = latest?.takeIf { it.session == session }
    val newCategory by viewModel.newCategory.collectAsState()
    BackHandler(onBack = onClose)
    LaunchedEffect(state?.done) { if (state?.done == true) onClose() }
    val title = when {
        target is EditorTarget.Fix -> R.string.editor_title_fix
        state?.isNew == true -> R.string.editor_title_new
        state?.form?.mode == EntryMode.Transfer -> R.string.editor_title_transfer
        else -> R.string.editor_title_entry
    }
    val actions = EditorActions(
        update = viewModel::update,
        save = viewModel::save,
        delete = viewModel::delete,
        close = onClose,
        toggleNewCategory = viewModel::toggleNewCategory,
        setNewCategoryName = viewModel::setNewCategoryName,
        createCategory = viewModel::createCategory,
    )
    Scaffold { padding -> EditorContent(state, newCategory, title, actions, Modifier.padding(padding).imePadding()) }
}
