package app.ledgerline.android

import kotlinx.coroutines.CancellationException

/**
 * The value of [block], or null when it failed. A cancellation is not a failure: it passes through, so a scope that is
 * stopped stops (AND-P6). For a step whose failure the screen answers with a message or a fallback, never with a crash.
 */
suspend fun <T : Any> orNull(block: suspend () -> T): T? = try {
    block()
} catch (e: CancellationException) {
    throw e
} catch (_: Exception) {
    null
}

/** True when [block] finished, false when it failed; a cancellation passes through. */
suspend fun succeeded(block: suspend () -> Unit): Boolean = orNull { block() } != null
