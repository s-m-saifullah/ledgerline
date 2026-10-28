package app.ledgerline.android.ui.editor

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.ui.categories.errorText
import app.ledgerline.android.ui.design.PrimaryButton

/**
 * The name box for a new category, as the web's quick add: a name and an Add category button, shown in the category
 * picker once "New category" is chosen. The category is top-level and of the entry's kind; once it is made it is chosen
 * for the entry.
 */
@Composable
fun NewCategoryFields(box: NewCategory, onName: (String) -> Unit, onCreate: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val label = stringResource(R.string.editor_new_category_name)
        Text(label, style = MaterialTheme.typography.bodyMedium)
        val invalid = box.name.isNotEmpty() && !box.valid
        OutlinedTextField(
            value = box.name,
            onValueChange = onName,
            isError = invalid,
            supportingText = if (invalid) ({ Text(stringResource(R.string.editor_new_category_invalid)) }) else null,
            singleLine = true,
            enabled = !box.creating,
            shape = MaterialTheme.shapes.small,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { onCreate() }),
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        )
        box.error?.let {
            Text(
                errorText(it),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(vertical = 4.dp).semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        PrimaryButton(
            stringResource(if (box.creating) R.string.editor_new_category_adding else R.string.editor_new_category_add),
            onClick = onCreate,
            enabled = box.valid && !box.creating,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
