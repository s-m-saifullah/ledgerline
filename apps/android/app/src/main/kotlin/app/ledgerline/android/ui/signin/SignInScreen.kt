package app.ledgerline.android.ui.signin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import app.ledgerline.android.ui.design.CardGap
import app.ledgerline.android.ui.design.GroupedListCard
import app.ledgerline.android.ui.design.InputRow
import app.ledgerline.android.ui.design.LinkButton
import app.ledgerline.android.ui.design.PickRow
import app.ledgerline.android.ui.design.PrimaryButton
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.TopBar

/** What the sign-in screen's fields and buttons do. */
class SignInActions(
    val onEmail: (String) -> Unit,
    val onPassword: (String) -> Unit,
    val onCode: (String) -> Unit,
    val onUseBackupCode: (Boolean) -> Unit,
    val submit: () -> Unit,
    val backToPassword: () -> Unit,
    val dismissNotice: () -> Unit,
    val changeAddress: () -> Unit,
)

/** Email and password, then the authenticator or backup code when the account asks for one. */
@Composable
fun SignInScreen(origin: String, onChangeAddress: () -> Unit, viewModel: SignInViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsState()
    val ended by viewModel.ended.collectAsState()
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        SignInContent(
            state,
            ended,
            origin,
            SignInActions(
                viewModel::onEmail, viewModel::onPassword, viewModel::onCode, viewModel::onUseBackupCode,
                viewModel::submit, viewModel::backToPassword, viewModel::dismissNotice, onChangeAddress,
            ),
            Modifier.safeDrawingPadding().imePadding(),
        )
    }
}

/**
 * Sign-in as plain data (ADR 0046): a top bar (a back arrow on the code step), the fields as rows in one card, one
 * primary button, a problem in words, and the server as one row that opens the address screen.
 */
@Composable
fun SignInContent(state: SignInUiState, ended: SessionEnd?, origin: String, actions: SignInActions, modifier: Modifier = Modifier) {
    val code = state.step == SignInStep.Code
    Column(modifier.fillMaxSize()) {
        TopBar(
            stringResource(if (code) R.string.code_title else R.string.signin_title),
            onBack = if (code) ({ if (!state.submitting) actions.backToPassword() }) else null,
        )
        Column(
            modifier = Modifier.verticalScroll(rememberScrollState()).padding(top = CardGap, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(CardGap),
        ) {
            ended?.let { reason ->
                Column(Modifier.padding(horizontal = ScreenMargin + 4.dp)) {
                    Text(stringResource(reason.text()), style = MaterialTheme.typography.bodyMedium)
                    LinkButton(stringResource(R.string.dismiss), actions.dismissNotice, Modifier.padding(start = 8.dp))
                }
            }
            when (state.step) {
                SignInStep.Password -> PasswordStep(state, actions)
                SignInStep.Code -> CodeStep(state, actions)
            }
            state.problem?.let {
                Text(
                    stringResource(it.messageRes()),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(horizontal = ScreenMargin + 4.dp),
                )
            }
            if (state.submitting) {
                Row(
                    modifier = Modifier.padding(horizontal = ScreenMargin + 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    Text(stringResource(R.string.signin_working), style = MaterialTheme.typography.bodyMedium)
                }
            }
            if (!code) {
                GroupedListCard { row { PickRow(stringResource(R.string.signin_server), origin.removePrefix("https://"), "", null, actions.changeAddress) } }
            }
        }
    }
}

private fun SessionEnd.text() = when (this) {
    SessionEnd.Expired -> R.string.signin_notice_expired
    SessionEnd.ServerNotReached -> R.string.signin_notice_server_not_reached
    SessionEnd.KeyLost -> R.string.signin_notice_key_lost
}

@Composable
private fun PasswordStep(state: SignInUiState, actions: SignInActions) {
    var showPassword by remember { mutableStateOf(false) }
    GroupedListCard {
        row {
            InputRow(
                label = stringResource(R.string.signin_email),
                value = state.email,
                onChange = actions.onEmail,
                enabled = !state.submitting,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                fieldModifier = Modifier.semantics { contentType = ContentType.EmailAddress },
            )
        }
        row {
            InputRow(
                label = stringResource(R.string.signin_password),
                value = state.password,
                onChange = actions.onPassword,
                enabled = !state.submitting,
                visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { actions.submit() }),
                fieldModifier = Modifier.semantics { contentType = ContentType.Password },
                trailing = { LinkButton(stringResource(if (showPassword) R.string.signin_hide else R.string.signin_show), { showPassword = !showPassword }) },
            )
        }
    }
    PrimaryButton(stringResource(R.string.signin_button), actions.submit, Modifier.fillMaxWidth().padding(horizontal = ScreenMargin), enabled = !state.submitting)
}

@Composable
private fun CodeStep(state: SignInUiState, actions: SignInActions) {
    GroupedListCard {
        row {
            InputRow(
                label = stringResource(if (state.useBackupCode) R.string.code_label_backup else R.string.code_label),
                value = state.code,
                onChange = actions.onCode,
                enabled = !state.submitting,
                keyboardOptions = KeyboardOptions(
                    keyboardType = if (state.useBackupCode) KeyboardType.Ascii else KeyboardType.NumberPassword,
                    imeAction = ImeAction.Done,
                ),
                keyboardActions = KeyboardActions(onDone = { actions.submit() }),
            )
        }
    }
    Text(
        stringResource(if (state.useBackupCode) R.string.code_intro_backup else R.string.code_intro),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = ScreenMargin + 4.dp),
    )
    PrimaryButton(stringResource(R.string.code_button), actions.submit, Modifier.fillMaxWidth().padding(horizontal = ScreenMargin), enabled = !state.submitting)
    LinkButton(
        stringResource(if (state.useBackupCode) R.string.code_use_code else R.string.code_use_backup),
        { actions.onUseBackupCode(!state.useBackupCode) },
        Modifier.padding(start = 8.dp),
        enabled = !state.submitting,
    )
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
