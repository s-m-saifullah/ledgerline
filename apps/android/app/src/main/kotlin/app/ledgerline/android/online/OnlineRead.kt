package app.ledgerline.android.online

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.transformLatest

/**
 * One thing read online whenever [trigger] emits, and only while it is collected (while the screen shows it, and
 * five seconds after). [view] says what a trigger shows (a client, a month): a reload of the same view keeps its
 * answer on screen until the new one arrives, another view shows Loading.
 */
@OptIn(ExperimentalCoroutinesApi::class)
fun <K, T> readOnTrigger(
    scope: CoroutineScope,
    trigger: Flow<K>,
    view: (K) -> Any,
    read: suspend (K) -> Online<T>,
): StateFlow<Online<T>> {
    var shown: Any? = null
    var last: Online<T> = Online.Loading
    return trigger
        .transformLatest { key ->
            val id = view(key)
            if (shown != id || last !is Online.Ready) emit(Online.Loading)
            shown = id
            emit(read(key))
        }
        .onEach { last = it }
        .stateIn(scope, SharingStarted.WhileSubscribed(5_000), Online.Loading)
}
