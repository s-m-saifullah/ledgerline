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
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AddressUiState(val input: String = "", val problem: AddressProblem? = null)

@HiltViewModel
class AddressViewModel @Inject constructor(private val store: ServerAddressStore) : ViewModel() {
    private val _state = MutableStateFlow(AddressUiState())
    val state: StateFlow<AddressUiState> = _state.asStateFlow()

    init {
        // Start from the saved address when the owner is changing it.
        viewModelScope.launch {
            store.origin.first()?.let { saved -> _state.update { if (it.input.isEmpty()) it.copy(input = saved) else it } }
        }
    }

    fun onInput(text: String) = _state.update { it.copy(input = text, problem = null) }

    /** [onSaved] runs once the address is stored. */
    fun submit(onSaved: () -> Unit) {
        when (val result = parseServerAddress(_state.value.input, BuildConfig.ALLOW_CLEARTEXT)) {
            is AddressResult.Refused -> _state.update { it.copy(problem = result.problem) }
            is AddressResult.Valid -> viewModelScope.launch {
                store.save(result.origin)
                onSaved()
            }
        }
    }
}
