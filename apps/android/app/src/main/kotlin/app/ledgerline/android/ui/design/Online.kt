package app.ledgerline.android.ui.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.ui.format.monthLabel
import app.ledgerline.android.ui.theme.LocalPalette

/* The pieces the screens read online share (Home's month, Budgets, Insights), named after their web classes. */

/** `.month-switcher`: previous and next around the month's name, which a screen reader announces as it changes. */
@Composable
fun MonthSwitcher(month: String, onPrevious: () -> Unit, onNext: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
        IconButton(onClick = onPrevious) {
            Icon(painterResource(R.drawable.ic_chevron_left), contentDescription = stringResource(R.string.month_previous))
        }
        Text(
            monthLabel(month),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(min = 96.dp).semantics { liveRegion = LiveRegionMode.Polite },
        )
        IconButton(onClick = onNext) {
            Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = stringResource(R.string.month_next))
        }
    }
}

/** `.budget-bar`: an 8 dp track filled to [share] (0 to 1) in the accent, or in red when [danger]. */
@Composable
fun ShareBar(share: Float, danger: Boolean = false) {
    val palette = LocalPalette.current
    Box(modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).background(palette.border)) {
        Box(
            modifier = Modifier
                .fillMaxWidth(share.coerceIn(0f, 1f))
                .fillMaxHeight()
                .clip(RoundedCornerShape(4.dp))
                .background(if (danger) palette.danger else palette.accent),
        )
    }
}

/** Whether the amount may sit beside the title: the room left for the title must hold its longest word and be at least [minTitle]. */
internal fun amountFitsBeside(roomForTitle: Int, longestWord: Int, minTitle: Int): Boolean = roomForTitle >= maxOf(longestWord, minTitle)

/**
 * A line's title with its amount beside it, as `.budget-line-top` and `.insight-line-top`; when the amount leaves
 * too little room for the title's longest word (a large amount or the largest text), the amount goes under the
 * title instead, so neither is broken. [minTitle] is the least the title may be squeezed to before that happens.
 */
@Composable
fun TitleAndAmount(title: @Composable () -> Unit, amount: @Composable () -> Unit, modifier: Modifier = Modifier, minTitle: Dp = 0.dp) {
    Layout(modifier = modifier, contents = listOf(title, amount)) { (titleParts, amountParts), constraints ->
        val gap = 12.dp.roundToPx()
        val amountPart = amountParts.single()
        val titlePart = titleParts.single()
        val amountWidth = amountPart.maxIntrinsicWidth(constraints.maxHeight)
        val beside = constraints.maxWidth - amountWidth - gap
        if (amountFitsBeside(beside, titlePart.minIntrinsicWidth(constraints.maxHeight), minTitle.roundToPx())) {
            val shownAmount = amountPart.measure(Constraints(maxWidth = amountWidth))
            val shownTitle = titlePart.measure(Constraints(maxWidth = beside))
            layout(constraints.maxWidth, maxOf(shownTitle.height, shownAmount.height)) {
                shownTitle.place(0, 0)
                shownAmount.place(constraints.maxWidth - shownAmount.width, 0)
            }
        } else {
            val shownTitle = titlePart.measure(Constraints(maxWidth = constraints.maxWidth))
            val shownAmount = amountPart.measure(Constraints(maxWidth = constraints.maxWidth))
            layout(constraints.maxWidth, shownTitle.height + shownAmount.height) {
                shownTitle.place(0, 0)
                shownAmount.place(0, shownTitle.height)
            }
        }
    }
}

/** A card saying why something read online is not shown (no connection, a server error), with Try again. */
@Composable
fun RetryNote(text: String, onRetry: () -> Unit) {
    LedgerCard {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            LinkButton(stringResource(R.string.try_again), onRetry)
        }
    }
}
