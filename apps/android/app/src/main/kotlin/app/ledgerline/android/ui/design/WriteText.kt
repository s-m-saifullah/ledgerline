package app.ledgerline.android.ui.design

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.ledgerline.android.online.WriteError

/** The sentences one screen uses for the ways an online write can end; the server's own sentence wins for a refusal. */
class WriteCopy(
    @StringRes val offline: Int,
    @StringRes val forbidden: Int,
    @StringRes val failed: Int,
    @StringRes val rejected: Int,
)

@Composable
fun WriteError.text(copy: WriteCopy): String = when (this) {
    WriteError.Offline -> stringResource(copy.offline)
    WriteError.Forbidden -> stringResource(copy.forbidden)
    WriteError.Failed -> stringResource(copy.failed)
    is WriteError.Rejected -> detail ?: stringResource(copy.rejected)
}
