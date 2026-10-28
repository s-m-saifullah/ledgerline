package app.ledgerline.android.ui.editor

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.ui.design.PrimaryButton
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SheetTitle

/** What a picker sheet chooses (ADR 0046): the editor's Account, To, Category and tag pickers all look the same. */
enum class Picker { Account, To, Category, Tag }

/** The "New category" name box inside the category picker; Cancel goes back to the list. */
@Composable
internal fun NewCategorySheetContent(box: NewCategory, onName: (String) -> Unit, onCreate: () -> Unit, onCancel: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth().padding(horizontal = ScreenMargin).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SheetTitle(stringResource(R.string.editor_new_category), onCancel)
        NewCategoryFields(box, onName, onCreate)
    }
}
