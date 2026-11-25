package app.ledgerline.android.ui.design

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.ledgerline.android.R
import app.ledgerline.android.online.WriteError

/**
 * The sentences one screen uses for the ways an online write can end; the server's own sentence wins for a refusal. Only
 * [forbidden] names the thing ("Your account can't ..."); the others are the same on every screen unless a screen has
 * something to say differently (a delete has nothing typed to keep, and says "delete").
 */
class WriteCopy(
    @StringRes val forbidden: Int,
    @StringRes val offline: Int = R.string.write_error_offline_kept,
    @StringRes val failed: Int = R.string.write_error_failed,
    @StringRes val rejected: Int = R.string.write_error_rejected,
)

@Composable
fun WriteError.text(copy: WriteCopy): String = when (this) {
    WriteError.Offline -> stringResource(copy.offline)
    WriteError.Forbidden -> stringResource(copy.forbidden)
    WriteError.Failed -> stringResource(copy.failed)
    is WriteError.Rejected -> detail ?: stringResource(copy.rejected)
}
