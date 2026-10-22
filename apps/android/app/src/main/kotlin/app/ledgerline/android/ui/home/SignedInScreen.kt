package app.ledgerline.android.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import app.ledgerline.android.R

/** Proof that sign-in works: the ledgers the account can open. The real screens come with the mirror. */
@Composable
fun SignedInScreen(origin: String, viewModel: SignedInViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsState()
    val signingOut by viewModel.signingOut.collectAsState()
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(stringResource(R.string.home_title), style = MaterialTheme.typography.headlineSmall)
            Text(
                stringResource(R.string.signin_server_line, origin),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            when (val current = state) {
                LedgersState.Loading -> Text(stringResource(R.string.home_loading))
                LedgersState.Failed -> {
                    Text(stringResource(R.string.home_failed), color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = viewModel::load, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(stringResource(R.string.try_again))
                    }
                }
                is LedgersState.Loaded -> {
                    Text(stringResource(R.string.home_ledgers), style = MaterialTheme.typography.titleMedium)
                    current.ledgers.forEach { ledger ->
                        Text("${ledger.name} · ${ledger.role} · ${ledger.baseCurrency}", style = MaterialTheme.typography.bodyLarge)
                    }
                }
            }
            OutlinedButton(
                onClick = viewModel::signOut,
                enabled = !signingOut,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.sign_out)) }
        }
    }
}
