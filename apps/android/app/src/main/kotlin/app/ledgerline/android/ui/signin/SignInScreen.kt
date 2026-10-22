package app.ledgerline.android.ui.signin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import app.ledgerline.android.R
import app.ledgerline.android.session.SessionEnd

/** Email and password, then the authenticator or backup code when the account asks for one. */
@Composable
fun SignInScreen(origin: String, onChangeAddress: () -> Unit, viewModel: SignInViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsState()
    val ended by viewModel.ended.collectAsState()
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            ended?.let { reason ->
                Text(
                    stringResource(
                        when (reason) {
                            SessionEnd.Expired -> R.string.signin_notice_expired
                            SessionEnd.ServerNotReached -> R.string.signin_notice_server_not_reached
                        },
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                TextButton(onClick = viewModel::dismissNotice, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.dismiss))
                }
            }
            when (state.step) {
                SignInStep.Password -> PasswordStep(state, viewModel)
                SignInStep.Code -> CodeStep(state, viewModel)
            }
            state.problem?.let {
                Text(
                    stringResource(it.messageRes()),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            if (state.submitting) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(modifier = Modifier.padding(4.dp))
                    Text(stringResource(R.string.signin_working), style = MaterialTheme.typography.bodyMedium)
                }
            }
            Text(
                stringResource(R.string.signin_server_line, origin),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (state.step == SignInStep.Password) {
                TextButton(onClick = onChangeAddress, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.address_change))
                }
            }
        }
    }
}

@Composable
private fun PasswordStep(state: SignInUiState, viewModel: SignInViewModel) {
    var showPassword by remember { mutableStateOf(false) }
    Text(stringResource(R.string.signin_title), style = MaterialTheme.typography.headlineSmall)
    OutlinedTextField(
        value = state.email,
        onValueChange = viewModel::onEmail,
        modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.EmailAddress },
        label = { Text(stringResource(R.string.signin_email)) },
        singleLine = true,
        enabled = !state.submitting,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
    )
    OutlinedTextField(
        value = state.password,
        onValueChange = viewModel::onPassword,
        modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.Password },
        label = { Text(stringResource(R.string.signin_password)) },
        singleLine = true,
        enabled = !state.submitting,
        visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
        trailingIcon = {
            TextButton(onClick = { showPassword = !showPassword }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(if (showPassword) R.string.signin_hide else R.string.signin_show))
            }
        },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { viewModel.submit() }),
    )
    Button(
        onClick = viewModel::submit,
        enabled = !state.submitting,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
    ) { Text(stringResource(R.string.signin_button)) }
}

@Composable
private fun CodeStep(state: SignInUiState, viewModel: SignInViewModel) {
    Text(stringResource(R.string.code_title), style = MaterialTheme.typography.headlineSmall)
    Text(
        stringResource(if (state.useBackupCode) R.string.code_intro_backup else R.string.code_intro),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    OutlinedTextField(
        value = state.code,
        onValueChange = viewModel::onCode,
        modifier = Modifier.fillMaxWidth(),
        label = { Text(stringResource(if (state.useBackupCode) R.string.code_label_backup else R.string.code_label)) },
        singleLine = true,
        enabled = !state.submitting,
        keyboardOptions = KeyboardOptions(
            keyboardType = if (state.useBackupCode) KeyboardType.Ascii else KeyboardType.NumberPassword,
            imeAction = ImeAction.Done,
        ),
        keyboardActions = KeyboardActions(onDone = { viewModel.submit() }),
    )
    Button(
        onClick = viewModel::submit,
        enabled = !state.submitting,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
    ) { Text(stringResource(R.string.code_button)) }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Switch(checked = state.useBackupCode, onCheckedChange = viewModel::onUseBackupCode, enabled = !state.submitting)
        Text(stringResource(R.string.code_use_backup), style = MaterialTheme.typography.bodyMedium)
    }
    TextButton(onClick = viewModel::backToPassword, enabled = !state.submitting, modifier = Modifier.heightIn(min = 48.dp)) {
        Text(stringResource(R.string.back))
    }
}

private fun SignInProblem.messageRes() = when (this) {
    SignInProblem.MissingFields -> R.string.signin_error_missing
    SignInProblem.MissingCode -> R.string.code_error_missing
    SignInProblem.BadCredentials -> R.string.signin_error_credentials
    SignInProblem.WrongCode -> R.string.code_error_wrong
    SignInProblem.RateLimited -> R.string.signin_error_rate_limited
    SignInProblem.AddressRejected -> R.string.signin_error_address
    SignInProblem.Server -> R.string.signin_error_server
    SignInProblem.Network -> R.string.signin_error_network
    SignInProblem.Unexpected -> R.string.signin_error_unexpected
}
