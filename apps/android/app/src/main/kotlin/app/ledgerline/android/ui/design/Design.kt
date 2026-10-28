package app.ledgerline.android.ui.design

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import app.ledgerline.android.ui.privacy.ShownMoney
import app.ledgerline.android.ui.theme.LocalPalette

/*
 * The web's building blocks on Android (ADR 0045), each named after its web class, so a screen that exists on
 * both looks the same: bordered surface cards with 12 dp corners on the background, borders instead of
 * shadows, and the web's type sizes from the theme.
 */

/** Tabular figures, so amounts line up, as the web's `font-variant-numeric: tabular-nums`. */
fun TextStyle.tabular() = copy(fontFeatureSettings = "tnum")

/** The side margin of every screen, and the space between cards. */
val ScreenMargin = 16.dp
val CardGap = 12.dp

/** `.settings-card`, `.activity-card`: a surface card with a 1 dp border. */
@Composable
fun LedgerCard(
    modifier: Modifier = Modifier,
    padding: PaddingValues = PaddingValues(20.dp),
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier.fillMaxWidth().padding(horizontal = ScreenMargin),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, LocalPalette.current.border),
    ) {
        Column(modifier = Modifier.padding(padding), content = content)
    }
}

/** A card's own heading, `h2` inside a card (19 sp), with an optional muted line under it. */
@Composable
fun CardTitle(title: String, detail: String? = null) {
    Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
    if (detail != null) {
        Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Two figures to a hero row, or one when the text is enlarged or an amount is long enough to be cut off in half a row. */
fun heroFiguresPerRow(fontScale: Float, amounts: List<String>): Int = if (fontScale > 1.3f || amounts.any { it.length > 11 }) 1 else 2

/** A figure shown small inside the hero: a label over an amount. */
class HeroFigure(val label: String, val amount: ShownMoney)

/**
 * The hero (ADR 0046): the one figure that matters most on a solid deep tint of the accent, light text, with
 * smaller figures under it (two to a row) and muted notes. No border and no shadow.
 */
@Composable
fun HeroCard(label: String, amount: ShownMoney, notes: List<String>, figures: List<HeroFigure> = emptyList()) {
    val palette = LocalPalette.current
    Surface(
        modifier = Modifier.fillMaxWidth().padding(horizontal = ScreenMargin),
        shape = MaterialTheme.shapes.large,
        color = palette.accentDeep,
        contentColor = palette.accentDeepForeground,
    ) {
        Column(
            modifier = Modifier
                .padding(20.dp)
                .clearAndSetSemantics {
                    contentDescription = (listOf(label, amount.spoken) + figures.map { "${it.label} ${it.amount.spoken}" } + notes).joinToString(", ")
                },
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(label, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = MaterialTheme.typography.titleSmall.fontWeight))
            Text(amount.text, style = MaterialTheme.typography.displayMedium.tabular(), maxLines = 1, softWrap = false, modifier = Modifier.padding(bottom = 4.dp))
            // Two to a row, unless the text is enlarged or an amount is long: then one to a row, so no amount is cut off.
            val perRow = heroFiguresPerRow(LocalDensity.current.fontScale, figures.map { it.amount.text })
            figures.chunked(perRow).forEach { row ->
                Row(modifier = Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    row.forEach { figure ->
                        Column(
                            modifier = Modifier
                                .weight(1f)
                                .background(palette.accentDeepForeground.copy(alpha = 0.12f), MaterialTheme.shapes.small)
                                .padding(horizontal = 12.dp, vertical = 10.dp),
                        ) {
                            Text(figure.label, style = MaterialTheme.typography.bodySmall)
                            Text(figure.amount.text, style = MaterialTheme.typography.titleMedium.tabular(), maxLines = 1, softWrap = false)
                        }
                    }
                    // A lone figure keeps half a row, so it lines up with the ones above.
                    if (row.size == 1 && perRow == 2) Spacer(Modifier.weight(1f))
                }
            }
            if (notes.isNotEmpty()) Column(modifier = Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                notes.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
            }
        }
    }
}

/** A day's date over its entries, with what the day came to (one figure per currency) at the right, in the muted colour. */
@Composable
fun DayHeader(text: String, net: String? = null) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = ScreenMargin + 4.dp, end = ScreenMargin + 4.dp, top = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(text, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f).semantics { heading() })
        if (net != null) {
            Text(net, style = MaterialTheme.typography.labelLarge.tabular(), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
    }
}

/** The button ladder (ADR 0039): filled for the one primary action, 8 dp corners as on the web. */
@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Button(onClick = onClick, enabled = enabled, shape = MaterialTheme.shapes.small, modifier = modifier.heightIn(min = 48.dp)) {
        Text(text, style = MaterialTheme.typography.labelLarge)
    }
}

/** Bordered, for the other actions. */
@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, danger: Boolean = false) {
    val palette = LocalPalette.current
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        shape = MaterialTheme.shapes.small,
        border = BorderStroke(1.dp, if (danger) palette.danger else palette.border),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = if (danger) palette.danger else palette.text),
        modifier = modifier.heightIn(min = 48.dp),
    ) { Text(text, style = MaterialTheme.typography.labelLarge) }
}

/** `.text-button`: the accent colour, for light actions such as Manage or Try again. */
@Composable
fun LinkButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    TextButton(onClick = onClick, enabled = enabled, shape = MaterialTheme.shapes.small, modifier = modifier.heightIn(min = 48.dp)) {
        Text(text, style = MaterialTheme.typography.labelLarge)
    }
}
