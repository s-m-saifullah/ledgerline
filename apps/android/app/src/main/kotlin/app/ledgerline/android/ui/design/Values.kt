package app.ledgerline.android.ui.design

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.ui.theme.LocalPalette
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/* A value in a pill and the date picker it opens: the one way a date is shown and chosen (the entry editor, the sheets, the Filters). */

/**
 * A tappable value in a pill: 36 dp to look at, 48 dp to touch. With [onClear] a ✕ sits inside the pill, after the value, and
 * clears it; its touch area is 48 dp, a little beyond the pill, and it is named [clearLabel] for a screen reader.
 */
@Composable
fun ValuePill(text: String, onClick: () -> Unit, dashed: Boolean = false, onClear: (() -> Unit)? = null, clearLabel: String = "") {
    val palette = LocalPalette.current
    if (onClear == null) {
        Box(modifier = Modifier.clickable(onClick = onClick, role = Role.Button).heightIn(min = TouchTarget), contentAlignment = Alignment.Center) {
            Box(
                modifier = Modifier
                    .height(36.dp)
                    .then(if (dashed) Modifier.border(1.dp, palette.border, ChipShape) else Modifier.background(palette.border.copy(alpha = 0.5f), ChipShape))
                    .padding(horizontal = 14.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(text, style = MaterialTheme.typography.labelLarge, color = if (dashed) palette.muted else palette.text, maxLines = 1)
            }
        }
        return
    }
    Box(modifier = Modifier.heightIn(min = TouchTarget), contentAlignment = Alignment.Center) {
        Row(
            modifier = Modifier.height(36.dp).background(palette.border.copy(alpha = 0.5f), ChipShape),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier.fillMaxHeight().clickable(onClick = onClick, role = Role.Button).padding(start = 14.dp, end = 4.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(text, style = MaterialTheme.typography.labelLarge, color = palette.text, maxLines = 1)
            }
            // A 32 dp slot in the pill whose touch area is 48 dp: it reaches past the pill rather than making it taller.
            Box(modifier = Modifier.width(32.dp).fillMaxHeight(), contentAlignment = Alignment.Center) {
                Box(
                    modifier = Modifier.requiredSize(TouchTarget).clickable(onClick = onClear, role = Role.Button).semantics { contentDescription = clearLabel },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(painterResource(R.drawable.ic_close), contentDescription = null, tint = palette.muted, modifier = Modifier.size(16.dp))
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DatePickerStep(date: String, onPick: (String) -> Unit, onClose: () -> Unit) {
    val initial = runCatching { LocalDate.parse(date) }.getOrNull()?.atStartOfDay()?.toInstant(ZoneOffset.UTC)?.toEpochMilli()
    val picker = rememberDatePickerState(initialSelectedDateMillis = initial)
    DatePickerDialog(
        onDismissRequest = onClose,
        confirmButton = {
            TextButton(shape = MaterialTheme.shapes.small, onClick = {
                picker.selectedDateMillis?.let { millis -> onPick(Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate().toString()) }
                onClose()
            }) { Text(stringResource(R.string.editor_date_ok)) }
        },
        dismissButton = { TextButton(shape = MaterialTheme.shapes.small, onClick = onClose) { Text(stringResource(R.string.cancel)) } },
    ) { DatePicker(state = picker) }
}
