package app.ledgerline.android.ui.design

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.text.style.TextOverflow
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

/** `.eyebrow` + `h1` + subtitle: the top of a page, scrolling with it. */
@Composable
fun PageHeader(title: String, eyebrow: String? = null, subtitle: String? = null) {
    Column(modifier = Modifier.fillMaxWidth().padding(start = ScreenMargin, end = ScreenMargin, top = 24.dp, bottom = 16.dp)) {
        if (eyebrow != null) {
            Text(
                eyebrow.uppercase(),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 8.dp),
            )
        }
        Text(title, style = MaterialTheme.typography.headlineMedium, modifier = Modifier.semantics { heading() })
        if (subtitle != null) {
            Text(
                subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}

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

/** A card's own heading, `h2` inside a card (20 sp), with an optional muted line under it. */
@Composable
fun CardTitle(title: String, detail: String? = null) {
    Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
    if (detail != null) {
        Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** `.home-hero`: the one figure that matters most, on the accent's soft fill with an accent border. */
@Composable
fun HeroCard(label: String, amount: ShownMoney, notes: List<String>) {
    val palette = LocalPalette.current
    Surface(
        modifier = Modifier.fillMaxWidth().padding(horizontal = ScreenMargin),
        shape = MaterialTheme.shapes.medium,
        color = palette.accentSoft,
        contentColor = palette.text,
        border = BorderStroke(1.dp, palette.accent),
    ) {
        Column(
            modifier = Modifier
                .padding(20.dp)
                .clearAndSetSemantics { contentDescription = (listOf(label, amount.spoken) + notes).joinToString(", ") },
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(label, style = MaterialTheme.typography.bodySmall.copy(fontWeight = MaterialTheme.typography.titleSmall.fontWeight))
            Text(amount.text, style = MaterialTheme.typography.displayMedium.tabular(), modifier = Modifier.padding(vertical = 4.dp))
            notes.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = palette.muted) }
        }
    }
}

/**
 * `.stat-card`: a label and a muted detail with the amount beside them, or under them when the card is too
 * narrow for both (the web's phone grid does the same), so an amount is never broken across lines.
 */
@Composable
fun StatCard(label: String, amount: ShownMoney, detail: String, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    val described = listOf(label, amount.spoken, detail).joinToString(", ")
    LedgerCard(
        modifier = modifier
            .let { if (onClick != null) it.clickable(onClick = onClick) else it }
            .clearAndSetSemantics { contentDescription = described },
        padding = PaddingValues(horizontal = 20.dp, vertical = 18.dp),
    ) {
        BoxWithConstraints {
            val figure = @Composable {
                Text(amount.text, style = MaterialTheme.typography.displaySmall.tabular(), maxLines = 1, softWrap = false)
            }
            val words = @Composable { modifier: Modifier ->
                Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(label, style = MaterialTheme.typography.bodySmall)
                    Text(detail, style = MaterialTheme.typography.labelMedium.copy(fontWeight = MaterialTheme.typography.bodySmall.fontWeight), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            // Stack when the card is narrow or the text is enlarged, so neither the words nor the amount squeeze.
            if (maxWidth < 300.dp * LocalDensity.current.fontScale.coerceAtLeast(1f)) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    words(Modifier)
                    figure()
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    words(Modifier.weight(1f).padding(end = 12.dp))
                    figure()
                }
            }
        }
    }
}

/** `.activity-card` with a `.section-heading`: a title row (with an optional text action) over divided rows. */
@Composable
fun ListCard(title: String, action: Pair<String, () -> Unit>? = null, content: @Composable ColumnScope.() -> Unit) {
    LedgerCard(padding = PaddingValues(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 4.dp)) {
        Row(modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f).semantics { heading() })
            if (action != null) LinkButton(action.first, onClick = action.second)
        }
        content()
    }
}

/**
 * A row in a list card: a bold title and muted lines on the left, the amount and a muted word under it on the
 * right, as the web's account and transaction rows. [divider] draws the line above it (not above the first).
 */
@Composable
fun AmountRow(
    title: String,
    details: List<String>,
    amount: ShownMoney,
    under: String?,
    described: String,
    divider: Boolean,
    underColor: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurfaceVariant,
    extra: (@Composable ColumnScope.() -> Unit)? = null,
    onClick: (() -> Unit)? = null,
) {
    if (divider) HorizontalDivider(color = LocalPalette.current.border)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .let { if (onClick != null) it.clickable(onClick = onClick) else it }
            .heightIn(min = 56.dp)
            .padding(vertical = 14.dp)
            .clearAndSetSemantics { contentDescription = described },
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            details.forEach {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            extra?.invoke(this)
        }
        Column(horizontalAlignment = Alignment.End, modifier = Modifier.padding(start = 12.dp)) {
            Text(amount.text, style = MaterialTheme.typography.titleMedium.tabular(), maxLines = 1, softWrap = false)
            if (under != null) Text(under, style = MaterialTheme.typography.bodyMedium, color = underColor)
        }
    }
}

/** `.transaction-day h2`: the date over a day's entries. */
@Composable
fun DayHeader(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleSmall.copy(fontSize = MaterialTheme.typography.bodyLarge.fontSize.times(15f / 16f)),
        modifier = Modifier.padding(start = ScreenMargin, end = ScreenMargin, top = 20.dp, bottom = 8.dp).semantics { heading() },
    )
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
fun LinkButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    TextButton(onClick = onClick, shape = MaterialTheme.shapes.small, modifier = modifier.heightIn(min = 48.dp)) {
        Text(text, style = MaterialTheme.typography.labelLarge)
    }
}
