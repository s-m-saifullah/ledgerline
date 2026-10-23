package app.ledgerline.android.ui.editor

import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue

/** Whether the owner typed amounts from the cents (More, Settings), provided once by the activity like privacy mode. */
val LocalCentsFirst = compositionLocalOf { false }

/**
 * The money box. With "Type amounts from the cents" off it is the ordinary box (a decimal keyboard, and the text is
 * checked when saved). With it on, typed digits fill in from the right and the caret stays at the end, as on the web.
 * Either way the box holds a plain decimal string, so the form, validation and the outbox see the same value.
 */
@Composable
fun AmountField(
    value: String,
    onValueChange: (String) -> Unit,
    digits: Int,
    centsFirst: Boolean,
    label: String,
    modifier: Modifier = Modifier,
    isError: Boolean = false,
    supportingText: String? = null,
) {
    // The field keeps its own selection; a text the form changed from outside (an entry opened) replaces it.
    var field by remember { mutableStateOf(TextFieldValue(value, TextRange(value.length))) }
    if (field.text != value) field = TextFieldValue(value, TextRange(value.length))
    OutlinedTextField(
        value = field,
        onValueChange = { typed ->
            if (!centsFirst) {
                field = typed
                if (typed.text != value) onValueChange(typed.text)
            } else {
                // A tap that only moves the caret keeps the text and puts the caret back at the end.
                val next = if (typed.text == field.text) field.text else CentsFirst.edit(field.text, typed.text, digits)
                field = TextFieldValue(next, TextRange(next.length))
                if (next != value) onValueChange(next)
            }
        },
        label = { Text(label) },
        placeholder = if (centsFirst) ({ Text(CentsFirst.placeholder(digits)) }) else null,
        textStyle = MaterialTheme.typography.headlineMedium.copy(fontFeatureSettings = "tnum"),
        keyboardOptions = KeyboardOptions(keyboardType = if (centsFirst) KeyboardType.Number else KeyboardType.Decimal),
        singleLine = true,
        isError = isError,
        supportingText = supportingText?.let { { Text(it) } },
        modifier = modifier,
    )
}
