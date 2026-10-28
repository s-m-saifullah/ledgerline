package app.ledgerline.android.ui.address

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import app.ledgerline.android.ui.design.CardGap
import app.ledgerline.android.ui.design.GroupedListCard
import app.ledgerline.android.ui.design.InputRow
import app.ledgerline.android.ui.design.PrimaryButton
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.TopBar

/** What the address screen's field and buttons do. */
class AddressActions(val onInput: (String) -> Unit, val onContinue: () -> Unit, val onCancel: () -> Unit)

/** Where is your server? One primary action. A back arrow is shown only when an address is already saved. */
@Composable
fun AddressScreen(canCancel: Boolean, onDone: () -> Unit, viewModel: AddressViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsState()
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        AddressContent(
            state,
            canCancel,
            AddressActions(viewModel::onInput, { viewModel.submit(onDone) }, onDone),
            Modifier.safeDrawingPadding().imePadding(),
        )
    }
}

/** The address screen as plain data (ADR 0046): a top bar, the address in one row, one hint, one Continue button. */
@Composable
fun AddressContent(state: AddressUiState, canCancel: Boolean, actions: AddressActions, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxSize()) {
        TopBar(stringResource(R.string.address_title), onBack = if (canCancel) actions.onCancel else null)
        Column(
            modifier = Modifier.verticalScroll(rememberScrollState()).padding(top = CardGap, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(CardGap),
        ) {
            GroupedListCard {
                row {
                    InputRow(
                        label = stringResource(R.string.address_label),
                        value = state.input,
                        onChange = actions.onInput,
                        error = state.problem?.let { stringResource(it.messageRes()) },
                        placeholder = stringResource(R.string.address_hint),
                        stacked = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { actions.onContinue() }),
                    )
                }
            }
            Text(
                stringResource(R.string.address_intro),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = ScreenMargin + 4.dp),
            )
            PrimaryButton(stringResource(R.string.address_continue), actions.onContinue, Modifier.fillMaxWidth().padding(horizontal = ScreenMargin))
        }
    }
}

private fun AddressProblem.messageRes() = when (this) {
    AddressProblem.Empty -> R.string.address_error_empty
    AddressProblem.Invalid -> R.string.address_error_invalid
    AddressProblem.Cleartext -> R.string.address_error_cleartext
    AddressProblem.Extras -> R.string.address_error_extras
}
