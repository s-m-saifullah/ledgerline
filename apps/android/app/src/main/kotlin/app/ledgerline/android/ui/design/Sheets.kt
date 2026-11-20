package app.ledgerline.android.ui.design

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.ui.theme.LocalPalette

/*
 * The sheets (WP-16, part 3): one bottom sheet and one actions sheet. No screen calls `ModalBottomSheet` or writes the
 * 24 dp top corners itself; `SharedPiecesTest` fails on both.
 */

/** The corners of every bottom sheet (ADR 0046: 24 for sheets). */
val SheetShape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)

/**
 * A bottom sheet over the screen: full height from the start (no half-open state), the surface color, the sheet shape;
 * a swipe away, a tap outside or Back asks [onDismiss], which chooses and saves nothing. A sheet with a search keeps one
 * height of its own, so the box never moves while the list narrows (see `PickerContent`).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LedgerSheet(onDismiss: () -> Unit, content: @Composable () -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface,
        shape = SheetShape,
    ) { content() }
}

/** One choice in an [ActionsSheet]: a disabled one stays in the list, muted, and does nothing; a danger one is red. */
class SheetAction(val label: String, val onClick: () -> Unit, val enabled: Boolean = true, val danger: Boolean = false)

/** What an actions sheet holds, apart from the sheet: its title with Cancel, and the choices as one grouped card of rows. */
@Composable
fun ActionsContent(title: String, onClose: () -> Unit, actions: List<SheetAction>, modifier: Modifier = Modifier) {
    val palette = LocalPalette.current
    Column(
        modifier = modifier.verticalScroll(rememberScrollState()).padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.padding(horizontal = ScreenMargin)) { SheetTitle(title, onClose) }
        GroupedListCard {
            actions.forEach { action ->
                row {
                    ListRow(
                        title = action.label,
                        titleColor = when {
                            !action.enabled -> palette.muted
                            action.danger -> palette.danger
                            else -> Color.Unspecified
                        },
                        enabled = action.enabled,
                        onClick = action.onClick,
                    )
                }
            }
        }
    }
}

/** The menu of a row or a person as a sheet (the ⋮ button opens it): the same look wherever there are actions to choose. */
@Composable
fun ActionsSheet(title: String, onClose: () -> Unit, actions: List<SheetAction>) {
    LedgerSheet(onClose) { ActionsContent(title, onClose, actions) }
}

/** The ⋮ button that opens an [ActionsSheet]: 48 dp, plain in a list row, outlined beside a primary button. */
@Composable
fun ActionsButton(description: String, onClick: () -> Unit, modifier: Modifier = Modifier, outlined: Boolean = false) {
    val palette = LocalPalette.current
    val sized = modifier.size(TouchTarget).semantics { contentDescription = description }
    if (outlined) {
        OutlinedIconButton(onClick = onClick, modifier = sized, shape = MaterialTheme.shapes.small, border = BorderStroke(1.dp, palette.border)) {
            Icon(painterResource(R.drawable.ic_more), contentDescription = null, tint = palette.text)
        }
    } else {
        IconButton(onClick = onClick, modifier = sized) {
            Icon(painterResource(R.drawable.ic_more), contentDescription = null, tint = palette.muted)
        }
    }
}
