package app.ledgerline.android.testing

import app.ledgerline.android.server.ServerAddressStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow

class FakeServerAddressStore(initial: String? = null) : ServerAddressStore {
    val state = MutableStateFlow(initial)
    override val origin: Flow<String?> = state

    override suspend fun save(origin: String) {
        state.value = origin
    }

    override suspend fun clear() {
        state.value = null
    }
}
