package app.ledgerline.android.ui.address

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.BuildConfig
import app.ledgerline.android.server.AddressProblem
import app.ledgerline.android.server.AddressResult
import app.ledgerline.android.server.ServerAddressStore
import app.ledgerline.android.server.parseServerAddress
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AddressUiState(
    /** Null while the saved address is still being read. */
    val savedOrigin: String? = null,
    val loaded: Boolean = false,
    val editing: Boolean = false,
    val input: String = "",
    val problem: AddressProblem? = null,
)

@HiltViewModel
class AddressViewModel @Inject constructor(
    private val store: ServerAddressStore,
) : ViewModel() {
    private val draft = MutableStateFlow(AddressUiState())

    val state: StateFlow<AddressUiState> = combine(store.origin, draft) { saved, draft ->
        draft.copy(savedOrigin = saved, loaded = true)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), AddressUiState())

    fun onInput(text: String) = draft.update { it.copy(input = text, problem = null) }

    fun startEditing() = draft.update { it.copy(editing = true, input = state.value.savedOrigin.orEmpty(), problem = null) }

    fun submit() {
        when (val result = parseServerAddress(draft.value.input, BuildConfig.ALLOW_CLEARTEXT)) {
            is AddressResult.Refused -> draft.update { it.copy(problem = result.problem) }
            is AddressResult.Valid -> viewModelScope.launch {
                store.save(result.origin)
                draft.update { it.copy(editing = false, input = "", problem = null) }
            }
        }
    }
}
