package app.ledgerline.android.ui.editor

import kotlinx.coroutines.CancellationException

/** Runs [block]; true when it finished, false when it failed. A cancellation is not a failure: it passes through. */
suspend fun succeeded(block: suspend () -> Unit): Boolean = try {
    block()
    true
} catch (e: CancellationException) {
    throw e
} catch (_: Exception) {
    false
}
