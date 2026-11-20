package app.ledgerline.android.ui.clients

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.ui.design.Question
import app.ledgerline.android.ui.design.WriteCopy
import app.ledgerline.android.ui.design.text
import app.ledgerline.android.ui.theme.LocalPalette

/** What the Delete service question can do, so it stays a function of plain data. */
class DeleteServiceActions(val confirm: () -> Unit, val dismiss: () -> Unit)

private val DeleteCopy = WriteCopy(
    offline = R.string.service_delete_error_offline,
    forbidden = R.string.service_delete_error_forbidden,
    failed = R.string.service_delete_error_failed,
    rejected = R.string.service_delete_error_rejected,
)

/**
 * The question before a service is deleted (ADR 0050, slice 5b; the prototype's "Delete service" confirm): the service, the
 * one rule, and Delete in the danger colour. A refusal (the server's own sentence when the service has payments) is shown
 * inside it, and the question stays so the sentence can be read.
 */
@Composable
internal fun DeleteServiceQuestion(ui: DeleteUi, actions: DeleteServiceActions) {
    Question(
        title = stringResource(R.string.service_delete_title),
        confirm = stringResource(R.string.service_delete_confirm),
        onConfirm = actions.confirm,
        onDismiss = actions.dismiss,
        danger = true,
        enabled = !ui.saving,
    ) {
        Text(ui.description, style = MaterialTheme.typography.titleMedium)
        Text(stringResource(R.string.service_delete_body))
        ui.error?.let { Text(it.text(DeleteCopy), color = MaterialTheme.colorScheme.error) }
    }
}
