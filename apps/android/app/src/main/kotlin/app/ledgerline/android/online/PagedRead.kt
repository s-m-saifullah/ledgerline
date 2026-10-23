package app.ledgerline.android.online

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.transformLatest

/** One page of a list read online: its rows, and the cursor of the next page (null on the last). */
data class Page<T>(val items: List<T>, val nextCursor: String?)

/** The rows read so far. [loadingMore] while the next page is on its way; [moreFailed] when it could not be read. */
data class Paged<T>(val items: List<T>, val hasMore: Boolean, val loadingMore: Boolean = false, val moreFailed: Boolean = false)

/**
 * A list read online a page at a time (Clients, Loans; ADR 0043, slice 5). [state] reads the first page whenever
 * [trigger] emits, and only while it is collected (while the screen shows it, and five seconds after); [loadMore]
 * appends the next page. [view] says what a trigger shows (a search, a status, a client): a reload of the same view
 * keeps its rows on screen until the new first page arrives, another view shows Loading.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PagedRead<K, T>(
    scope: CoroutineScope,
    trigger: Flow<K>,
    private val view: (K) -> Any,
    private val fetch: suspend (key: K, cursor: String?) -> Online<Page<T>>,
) {
    private val more = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    private var shown: Any? = null
    private var last: Online<Paged<T>> = Online.Loading

    val state: StateFlow<Online<Paged<T>>> = trigger
        .transformLatest { key ->
            val id = view(key)
            if (shown != id || last !is Online.Ready) emit(Online.Loading)
            shown = id
            when (val first = fetch(key, null)) {
                is Online.Ready -> {
                    var rows = first.value.items
                    var cursor = first.value.nextCursor
                    emit(Online.Ready(Paged(rows, hasMore = cursor != null)))
                    more.collect {
                        val next = cursor ?: return@collect
                        emit(Online.Ready(Paged(rows, hasMore = true, loadingMore = true)))
                        when (val page = fetch(key, next)) {
                            is Online.Ready -> {
                                rows = rows + page.value.items
                                // A cursor the server repeats would loop; the web stops on one as well.
                                cursor = page.value.nextCursor?.takeIf { it != next }
                                emit(Online.Ready(Paged(rows, hasMore = cursor != null)))
                            }
                            else -> emit(Online.Ready(Paged(rows, hasMore = true, moreFailed = true)))
                        }
                    }
                }
                Online.Offline -> emit(Online.Offline)
                Online.Failed -> emit(Online.Failed)
                Online.Loading -> Unit
            }
        }
        .onEach { last = it }
        .stateIn(scope, SharingStarted.WhileSubscribed(5_000), Online.Loading)

    /** Reads the next page, when there is one; a request while one is on its way is dropped. */
    fun loadMore() {
        if ((last as? Online.Ready)?.value?.loadingMore == true) return
        more.tryEmit(Unit)
    }
}
