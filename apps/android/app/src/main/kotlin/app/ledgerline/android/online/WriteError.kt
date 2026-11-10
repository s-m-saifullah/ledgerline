package app.ledgerline.android.online

/** Why an online write did not finish, the same for every write (ADR 0050). The words belong to each screen. */
sealed interface WriteError {
    /** No connection, or the answer was lost. Whatever was typed is kept; sending again with the same key is safe. */
    data object Offline : WriteError

    /** The signed-in account may not change this ledger (a viewer). */
    data object Forbidden : WriteError

    /** The server failed, or answered with something this version cannot read. */
    data object Failed : WriteError

    /** The server's own sentence (a version that moved on, a rule it refuses); null when it gave none. */
    data class Rejected(val detail: String?) : WriteError
}

/** The error a person is shown for this outcome; null when the write went through. */
fun Written<*>.toWriteError(): WriteError? = when (this) {
    is Written.Done -> null
    Written.Offline -> WriteError.Offline
    Written.Forbidden -> WriteError.Forbidden
    Written.Failed -> WriteError.Failed
    is Written.Rejected -> WriteError.Rejected(detail)
}

/** The server says the thing changed or is gone (`409`, `404`): the screen reads it again and shows the sentence. */
fun Written<*>.isStale(): Boolean = this is Written.Rejected && (status == 409 || status == 404)
