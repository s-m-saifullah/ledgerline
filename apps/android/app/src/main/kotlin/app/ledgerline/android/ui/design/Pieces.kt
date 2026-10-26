package app.ledgerline.android.ui.design

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.takeOrElse
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.ui.format.monthLabel
import app.ledgerline.android.ui.theme.LedgerlinePalette
import app.ledgerline.android.ui.theme.LocalPalette

/*
 * The redesign's building blocks (ADR 0046). Each is a function of plain data, so a screen's content can be
 * rendered in a test or a screenshot without a view model. They replace PageHeader, ListCard, NavCard, StatCard
 * and ShareBar screen by screen; those are deleted when nothing uses them.
 */

/** The least height of a touch target on Android (ADR 0046); the least height of a list row is [RowHeight]. */
val TouchTarget = 48.dp
val RowHeight = 56.dp

/** The fixed bar at the top of a screen: the title (19 sp), a back arrow where there is one, at most one action. */
@Composable
fun TopBar(title: String, onBack: (() -> Unit)? = null, action: (@Composable RowScope.() -> Unit)? = null) {
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(start = if (onBack == null) ScreenMargin else 4.dp, end = ScreenMargin),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) {
            IconButton(onClick = onBack, modifier = Modifier.size(TouchTarget)) {
                Icon(painterResource(R.drawable.ic_chevron_left), contentDescription = stringResource(R.string.back))
            }
        }
        Text(
            title,
            style = MaterialTheme.typography.titleLarge,
            // Two lines, so the largest text wraps a long title instead of cutting it off.
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f).padding(horizontal = if (onBack == null) 0.dp else 4.dp, vertical = 4.dp).semantics { heading() },
        )
        action?.invoke(this)
    }
}

/** The month in a top bar (ADR 0046): previous and next around the month's name, which a screen reader announces as it changes. */
@Composable
fun MonthControl(month: String, onPrevious: () -> Unit, onNext: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onPrevious, modifier = Modifier.size(TouchTarget)) {
            Icon(painterResource(R.drawable.ic_chevron_left), contentDescription = stringResource(R.string.month_previous))
        }
        Text(
            monthLabel(month),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(min = 72.dp).semantics { liveRegion = LiveRegionMode.Polite },
        )
        IconButton(onClick = onNext, modifier = Modifier.size(TouchTarget)) {
            Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = stringResource(R.string.month_next))
        }
    }
}

/** Two to four choices in one rounded track; the selected one is raised and bold. Each segment is a touch target. */
@Composable
fun SegmentedControl(options: List<String>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    val palette = LocalPalette.current
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.small)
            .background(palette.border.copy(alpha = 0.5f))
            .padding(4.dp)
            .selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        options.forEachIndexed { index, label ->
            val on = index == selected
            Surface(
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = TouchTarget)
                    .selectable(selected = on, onClick = { onSelect(index) }, role = Role.RadioButton),
                shape = MaterialTheme.shapes.extraSmall,
                color = if (on) palette.surface else Color.Transparent,
                contentColor = if (on) palette.text else palette.muted,
                border = if (on) BorderStroke(1.dp, palette.border) else null,
            ) {
                Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp)) {
                    Text(
                        label,
                        style = MaterialTheme.typography.labelLarge.copy(fontWeight = MaterialTheme.typography.titleSmall.fontWeight.takeIf { on }),
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }
    }
}

/** What a [GroupedListCard] collects: one entry per row, with a hairline between neighbours. */
class GroupedRows {
    internal val rows = mutableListOf<@Composable () -> Unit>()
    fun row(content: @Composable () -> Unit) {
        rows += content
    }
}

/** A group of rows in one bordered card with hairline dividers, as the concept's grouped lists. */
@Composable
fun GroupedListCard(modifier: Modifier = Modifier, rows: GroupedRows.() -> Unit) {
    val collected = GroupedRows().apply(rows).rows
    LedgerCard(modifier = modifier, padding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
        collected.forEachIndexed { index, row ->
            if (index > 0) HorizontalDivider(color = LocalPalette.current.border)
            row()
        }
    }
}

/** One row of a grouped list: an optional leading mark, a title and subtitle, a trailing value, at least [RowHeight] tall. */
@Composable
fun ListRow(
    title: String,
    subtitle: String? = null,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)? = null,
    subtitleColor: Color = Color.Unspecified,
    /** What a screen reader says for the whole row, when it should be one sentence (the amount's spoken form, not its mask). */
    described: String? = null,
    /** More under the subtitle, such as a row of tags. */
    extra: (@Composable ColumnScope.() -> Unit)? = null,
    /** A pill beside the title, such as [StatusPill]. */
    badge: (@Composable () -> Unit)? = null,
    /** What a screen reader says a tap does ("Show payments"), when the row has more than one use. */
    onClickLabel: String? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClickLabel = onClickLabel, onClick = onClick, role = Role.Button) else Modifier)
            .heightIn(min = RowHeight)
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .then(if (described != null) Modifier.clearAndSetSemantics { contentDescription = described } else Modifier),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        leading?.invoke()
        val words: @Composable () -> Unit = {
            Column {
                if (badge == null) {
                    Text(title, style = MaterialTheme.typography.titleMedium)
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f, fill = false))
                        badge()
                    }
                }
                if (subtitle != null) {
                    Text(subtitle, style = MaterialTheme.typography.bodySmall, color = subtitleColor.takeOrElse { MaterialTheme.colorScheme.onSurfaceVariant })
                }
                extra?.invoke(this)
            }
        }
        // The amount goes under the words when it would squeeze them (a large amount, the largest text).
        if (trailing == null) Box(Modifier.weight(1f)) { words() } else TitleAndAmount(words, trailing, minTitle = 80.dp, modifier = Modifier.weight(1f))
    }
}

/** How a [StatusPill] reads: red for what needs attention (overdue), the accent for what is done. */
enum class PillTone { Danger, Accent }

/** A small outlined word beside a title (Overdue); colour is never the only cue, the word says it. */
@Composable
fun StatusPill(text: String, tone: PillTone = PillTone.Danger) {
    val palette = LocalPalette.current
    val color = if (tone == PillTone.Danger) palette.danger else palette.accent
    Text(
        text,
        style = MaterialTheme.typography.labelMedium,
        color = color,
        maxLines = 1,
        modifier = Modifier.border(1.dp, color, RoundedCornerShape(8.dp)).padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

/** The one or two capital letters that stand for [name]: its first letters of the first two words, or "?" for none. */
fun initialsOf(name: String): String {
    val words = name.trim().split(Regex("\\s+")).filter { word -> word.any { it.isLetterOrDigit() } }
    val letters = when {
        words.isEmpty() -> return "?"
        words.size == 1 -> words[0].filter { it.isLetterOrDigit() }.take(2)
        else -> words.take(2).joinToString("") { it.first { c -> c.isLetterOrDigit() }.toString() }
    }
    return letters.uppercase()
}

/** A tile, at least 40 dp and growing with the phone's text size, with [name]'s initials on the accent's soft fill: no emoji, and nothing to store. */
@Composable
fun Avatar(name: String) {
    val palette = LocalPalette.current
    Box(
        modifier = Modifier.defaultMinSize(minWidth = 40.dp, minHeight = 40.dp).background(palette.accentSoft, MaterialTheme.shapes.small).padding(horizontal = 4.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(initialsOf(name), style = MaterialTheme.typography.labelLarge, color = palette.accent)
    }
}

/** A tile like [Avatar] with an icon in it, for a row that is not a person or an account (a transfer). */
@Composable
fun IconAvatar(icon: Int) {
    val palette = LocalPalette.current
    Box(
        modifier = Modifier.defaultMinSize(minWidth = 40.dp, minHeight = 40.dp).background(palette.accentSoft, MaterialTheme.shapes.small),
        contentAlignment = Alignment.Center,
    ) {
        Icon(painterResource(icon), contentDescription = null, tint = palette.accent, modifier = Modifier.size(20.dp))
    }
}

/**
 * A search box (ADR 0046): a filled field with the [label] as its hint (a screen reader reads it too), a cross
 * that empties it while there is text, and 48 dp tall. It replaces SearchField screen by screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchBox(label: String, value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
    val palette = LocalPalette.current
    val clear = stringResource(R.string.clear_search)
    val interaction = remember { MutableInteractionSource() }
    val container = palette.border.copy(alpha = 0.5f)
    // A Material TextField is 56 dp tall at the least; this is the same field at the 48 dp the row beside it needs.
    BasicTextField(
        value = value,
        onValueChange = { onChange(it.take(200)) },
        singleLine = true,
        textStyle = MaterialTheme.typography.bodyLarge.copy(color = palette.text),
        cursorBrush = SolidColor(palette.accent),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        interactionSource = interaction,
        modifier = modifier.fillMaxWidth().heightIn(min = TouchTarget).semantics { contentDescription = label },
        decorationBox = { inner ->
            TextFieldDefaults.DecorationBox(
                value = value,
                innerTextField = inner,
                enabled = true,
                singleLine = true,
                visualTransformation = VisualTransformation.None,
                interactionSource = interaction,
                placeholder = { Text(label, color = palette.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge) },
                leadingIcon = { Icon(painterResource(R.drawable.ic_search), contentDescription = null, tint = palette.muted, modifier = Modifier.size(20.dp)) },
                trailingIcon = if (value.isEmpty()) null else {
                    {
                        IconButton(onClick = { onChange("") }) {
                            Icon(painterResource(R.drawable.ic_close), contentDescription = clear, modifier = Modifier.size(20.dp))
                        }
                    }
                },
                shape = MaterialTheme.shapes.small,
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = container,
                    unfocusedContainerColor = container,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    disabledIndicatorColor = Color.Transparent,
                ),
                contentPadding = TextFieldDefaults.contentPaddingWithoutLabel(top = 0.dp, bottom = 0.dp),
            )
        },
    )
}

/** The button beside a search box that opens its filters: an icon, Filters, and how many are set (then it takes the accent's soft fill). */
@Composable
fun FiltersButton(count: Int, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val palette = LocalPalette.current
    val label = stringResource(R.string.filters_chip)
    val described = if (count > 0) stringResource(R.string.filters_chip_count, count) else label
    val shape = MaterialTheme.shapes.small
    Row(
        modifier = modifier
            .heightIn(min = TouchTarget)
            .clip(shape)
            .background(if (count > 0) palette.accentSoft else palette.surface)
            .border(1.dp, if (count > 0) palette.accent else palette.border, shape)
            .clickable(onClick = onClick, role = Role.Button)
            .clearAndSetSemantics { contentDescription = described }
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(painterResource(R.drawable.ic_filters), contentDescription = null, modifier = Modifier.size(20.dp))
        Text(label, style = MaterialTheme.typography.labelLarge, maxLines = 1)
        if (count > 0) {
            Box(modifier = Modifier.defaultMinSize(minWidth = 22.dp, minHeight = 22.dp).background(palette.accent, RoundedCornerShape(11.dp)), contentAlignment = Alignment.Center) {
                Text(count.toString(), style = MaterialTheme.typography.labelMedium, color = palette.accentForeground, modifier = Modifier.padding(horizontal = 6.dp))
            }
        }
    }
}

/** How full a limit is: the accent, the warning at 90 per cent of it and above, red over it. */
enum class LimitState { Within, Near, Over }

fun limitState(used: Long, limit: Long): LimitState = when {
    limit <= 0 -> LimitState.Within
    used > limit -> LimitState.Over
    used * 10 >= limit * 9 -> LimitState.Near
    else -> LimitState.Within
}

/** An 8 dp track filled to [share] (0 to 1): the accent, the warning colour near the limit, red over it. */
@Composable
fun ProportionBar(share: Float, state: LimitState = LimitState.Within) {
    val palette = LocalPalette.current
    val fill = when (state) {
        LimitState.Within -> palette.accent
        LimitState.Near -> palette.warning
        LimitState.Over -> palette.danger
    }
    Box(modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).background(palette.border)) {
        Box(modifier = Modifier.fillMaxWidth(share.coerceIn(0f, 1f)).fillMaxHeight().clip(RoundedCornerShape(4.dp)).background(fill))
    }
}

/** The ramp colour of the [index]th largest part (0 first): five tints of the accent, then the neutral for every other part. */
fun chartColor(palette: LedgerlinePalette, index: Int): Color = when (index) {
    0 -> palette.chart1
    1 -> palette.chart2
    2 -> palette.chart3
    3 -> palette.chart4
    4 -> palette.chart5
    else -> palette.fieldBorder
}

/** One bar split into parts by their [shares], each in its ramp colour with a 2 dp gap; the labels sit beside it, so colour is never the only cue. */
@Composable
fun SegmentedBar(shares: List<Float>) {
    val palette = LocalPalette.current
    Row(modifier = Modifier.fillMaxWidth().height(12.dp).clip(RoundedCornerShape(6.dp)), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        shares.forEachIndexed { index, share ->
            if (share > 0f) Box(modifier = Modifier.weight(share).fillMaxHeight().background(chartColor(palette, index)))
        }
    }
}

/** A pill that filters a list; selected it takes the accent's soft fill. The pill is 36 dp, the touch target 48. */
@Composable
fun FilterChip(label: String, selected: Boolean, onClick: () -> Unit) {
    val palette = LocalPalette.current
    Box(
        modifier = Modifier
            .selectable(selected = selected, onClick = onClick, role = Role.Checkbox)
            .heightIn(min = TouchTarget),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .height(36.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(if (selected) palette.accentSoft else palette.surface)
                .border(1.dp, if (selected) palette.accent else palette.border, RoundedCornerShape(18.dp))
                .padding(horizontal = 14.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                label,
                style = MaterialTheme.typography.labelLarge,
                color = if (selected) palette.text else palette.muted,
                maxLines = 1,
            )
        }
    }
}

/** A small capitals label over a group (10 sp, the floor). */
@Composable
fun SectionLabel(text: String) {
    Text(
        text.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = ScreenMargin + 4.dp).padding(top = 8.dp).semantics { heading() },
    )
}

/** Nothing to show: one sentence and at most one action. */
@Composable
fun EmptyState(text: String, action: Pair<String, () -> Unit>? = null) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = ScreenMargin * 2, vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        if (action != null) SecondaryButton(action.first, action.second)
    }
}
