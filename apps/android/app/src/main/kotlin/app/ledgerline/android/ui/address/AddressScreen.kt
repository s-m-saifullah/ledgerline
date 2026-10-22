package app.ledgerline.android.ui.address

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
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

/** Where is your server? One primary action. [onCancel] is shown only when an address is already saved. */
@Composable
fun AddressScreen(canCancel: Boolean, onDone: () -> Unit, viewModel: AddressViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsState()
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(stringResource(R.string.address_title), style = MaterialTheme.typography.headlineSmall)
            Text(
                stringResource(R.string.address_intro),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = state.input,
                onValueChange = viewModel::onInput,
                modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.address_label)) },
                placeholder = { Text(stringResource(R.string.address_hint)) },
                singleLine = true,
                isError = state.problem != null,
                supportingText = state.problem?.let { { Text(stringResource(it.messageRes())) } },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { viewModel.submit(onDone) }),
            )
            Button(onClick = { viewModel.submit(onDone) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text(stringResource(R.string.address_continue))
            }
            if (canCancel) {
                TextButton(onClick = onDone, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.cancel))
                }
            }
        }
    }
}

private fun AddressProblem.messageRes() = when (this) {
    AddressProblem.Empty -> R.string.address_error_empty
    AddressProblem.Invalid -> R.string.address_error_invalid
    AddressProblem.Cleartext -> R.string.address_error_cleartext
    AddressProblem.Extras -> R.string.address_error_extras
}
