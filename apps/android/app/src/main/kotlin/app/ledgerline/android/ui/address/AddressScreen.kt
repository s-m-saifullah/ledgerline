package app.ledgerline.android.ui.address

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import app.ledgerline.android.R
import app.ledgerline.android.server.AddressProblem

/** First screen: where is your server? One primary action. */
@Composable
fun AddressScreen(viewModel: AddressViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsState()
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            when {
                !state.loaded -> Unit
                state.savedOrigin != null && !state.editing -> SavedAddress(
                    origin = state.savedOrigin.orEmpty(),
                    onChange = viewModel::startEditing,
                )
                else -> AddressForm(
                    input = state.input,
                    problem = state.problem,
                    onInput = viewModel::onInput,
                    onSubmit = viewModel::submit,
                )
            }
        }
    }
}

@Composable
private fun AddressForm(
    input: String,
    problem: AddressProblem?,
    onInput: (String) -> Unit,
    onSubmit: () -> Unit,
) {
    Text(stringResource(R.string.address_title), style = MaterialTheme.typography.headlineSmall)
    Text(
        stringResource(R.string.address_intro),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    OutlinedTextField(
        value = input,
        onValueChange = onInput,
        modifier = Modifier.fillMaxWidth(),
        label = { Text(stringResource(R.string.address_label)) },
        placeholder = { Text(stringResource(R.string.address_hint)) },
        singleLine = true,
        isError = problem != null,
        supportingText = problem?.let { { Text(stringResource(it.messageRes())) } },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onSubmit() }),
    )
    Button(onClick = onSubmit, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
        Text(stringResource(R.string.address_continue))
    }
}

@Composable
private fun SavedAddress(origin: String, onChange: () -> Unit) {
    Text(stringResource(R.string.address_saved_title), style = MaterialTheme.typography.headlineSmall)
    Text(origin, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
    Text(
        stringResource(R.string.address_saved_body),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(8.dp))
    TextButton(onClick = onChange, modifier = Modifier.heightIn(min = 48.dp)) {
        Text(stringResource(R.string.address_change))
    }
}

private fun AddressProblem.messageRes() = when (this) {
    AddressProblem.Empty -> R.string.address_error_empty
    AddressProblem.Invalid -> R.string.address_error_invalid
    AddressProblem.Cleartext -> R.string.address_error_cleartext
    AddressProblem.Extras -> R.string.address_error_extras
}
