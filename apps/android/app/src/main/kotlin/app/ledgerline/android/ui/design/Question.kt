package app.ledgerline.android.ui.design

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.material3.BasicAlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.ui.theme.LocalPalette

/*
 * The question every confirmation uses (WP-16; the web's `Question`): a title, a few words, an outlined Cancel and the
 * confirming action as a filled button, red when it deletes. No screen builds a dialog of its own: `SharedPiecesTest`
 * fails on `AlertDialog` outside this file.
 */

/** Another action beside the two, such as "Delete 3 unsent changes": an outlined button, red when [danger]. */
class QuestionAction(val label: String, val onClick: () -> Unit, val danger: Boolean = false)

/**
 * Whether the buttons go one under another: three or more always do, and two do when the text is much larger than usual
 * (two long words would not fit side by side).
 */
fun questionStacked(fontScale: Float, buttons: Int): Boolean = buttons >= 3 || fontScale > 1.3f

/**
 * A question in a window over the screen. [confirm] is the action; [cancel] is the word on the plain way out (null leaves only
 * the one button, for a notice such as "this is in use"); [extra] is a third choice. [enabled] false stops every button while
 * a request is on its way.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Question(
    title: String,
    confirm: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    danger: Boolean = false,
    enabled: Boolean = true,
    cancel: String? = stringResource(R.string.cancel),
    extra: QuestionAction? = null,
    body: @Composable ColumnScope.() -> Unit = {},
) {
    BasicAlertDialog(onDismissRequest = onDismiss) {
        QuestionCard(title, confirm, onConfirm, onDismiss, modifier, danger, enabled, cancel, extra, body)
    }
}

/** What the window holds, apart from the window, so it can be drawn in a screenshot and measured in a test. */
@Composable
fun QuestionCard(
    title: String,
    confirm: String,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    danger: Boolean = false,
    enabled: Boolean = true,
    cancel: String? = stringResource(R.string.cancel),
    extra: QuestionAction? = null,
    body: @Composable ColumnScope.() -> Unit = {},
) {
    val palette = LocalPalette.current
    Surface(
        modifier = modifier.sizeIn(minWidth = 280.dp, maxWidth = 560.dp),
        shape = MaterialTheme.shapes.extraLarge,
        color = palette.surface,
        border = BorderStroke(1.dp, palette.border),
    ) {
        Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(title, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                body()
            }
            val buttons = 1 + (if (cancel != null) 1 else 0) + (if (extra != null) 1 else 0)
            val confirmButton: @Composable (Modifier) -> Unit = { m -> PrimaryButton(confirm, onConfirm, m, enabled, danger) }
            val cancelButton: @Composable (Modifier) -> Unit = { m -> if (cancel != null) SecondaryButton(cancel, onCancel, m, enabled) }
            val extraButton: @Composable (Modifier) -> Unit = { m -> if (extra != null) SecondaryButton(extra.label, extra.onClick, m, enabled, extra.danger) }
            if (questionStacked(LocalDensity.current.fontScale, buttons)) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    confirmButton(Modifier.fillMaxWidth())
                    cancelButton(Modifier.fillMaxWidth())
                    extraButton(Modifier.fillMaxWidth())
                }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    cancelButton(Modifier.weight(1f))
                    confirmButton(Modifier.weight(1f))
                }
            }
        }
    }
}
