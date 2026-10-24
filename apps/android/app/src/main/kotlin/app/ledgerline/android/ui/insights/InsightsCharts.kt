package app.ledgerline.android.ui.insights

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import androidx.compose.ui.unit.sp
import app.ledgerline.android.R
import app.ledgerline.android.ui.design.LedgerCard
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.TitleAndAmount
import app.ledgerline.android.ui.design.tabular
import app.ledgerline.android.ui.format.monthLabel
import app.ledgerline.android.ui.format.shortMonth
import app.ledgerline.android.ui.privacy.LocalPrivacy
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.android.ui.theme.LocalPalette
import app.ledgerline.api.CashFlowReport
import app.ledgerline.api.NetWorthMonth
import app.ledgerline.api.NetWorthReport
import kotlin.math.abs

/** A cash flow bar's height as a share of the chart (0 to 1): the month's peak fills it, and any money shows. */
fun flowHeight(cents: Long, peak: Long): Float =
    if (cents > 0 && peak > 0) (cents.toDouble() / peak).toFloat().coerceIn(0.02f, 1f) else 0f

/** Where a net worth bar sits: its [bottom] edge and [height], as shares of the chart's height from the bottom. */
data class WorthBar(val bottom: Float, val height: Float)

/** The net worth chart's scale: from the lowest value (or 0) to the highest (or 0), as on the web. */
class WorthScale(values: List<Long>) {
    private val high = maxOf(0L, values.maxOrNull() ?: 0L)
    private val low = minOf(0L, values.minOrNull() ?: 0L)
    private val range = (high - low).toDouble()

    /** Where zero sits when some month is below it, so a line can mark it; null when every month is at or above it. */
    val zero: Float? = if (low < 0 && range > 0) ((0 - low) / range).toFloat() else null

    fun bar(cents: Long): WorthBar {
        if (range == 0.0) return WorthBar(0f, 0f)
        val edge = if (cents >= 0) 0L else cents
        val height = if (cents == 0L) 0f else (abs(cents) / range).toFloat().coerceAtLeast(0.01f)
        return WorthBar(((edge - low) / range).toFloat(), height)
    }
}

/**
 * How often a month is named under the chart: every month when the widest name fits its column (a name may run
 * a little into the gap, as on the web), else every 2nd, 3rd, 4th or 6th month, so names never overlap at 320 dp
 * or with the largest text. The figures and the screen reader still have every month.
 */
fun labelStep(widest: Float, column: Float, gap: Float): Int =
    listOf(1, 2, 3, 4, 6).firstOrNull { step -> widest <= column * step + gap * (step - 1) + gap } ?: ChartMonths

private val ChartHeight = 120.dp

/** `.flow-chart`: twelve month columns with their short names, the chosen one on the accent's soft fill. */
@Composable
private fun ChartCard(
    described: String,
    months: List<String>,
    selected: String,
    bars: DrawScope.(index: Int) -> Unit,
) {
    val palette = LocalPalette.current
    val hidden = LocalPrivacy.current
    val labelStyle = MaterialTheme.typography.labelSmall.copy(fontSize = 12.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold)
    val measurer = rememberTextMeasurer()
    val names = months.map { shortMonth(it) }
    LedgerCard(padding = PaddingValues(start = 12.dp, end = 12.dp, top = 16.dp, bottom = 8.dp), modifier = Modifier.clearAndSetSemantics { contentDescription = described }) {
        BoxWithConstraints {
            val gap = 4.dp
            val column = (maxWidth - gap * (ChartMonths - 1)) / ChartMonths
            val widest = names.maxOfOrNull { measurer.measure(it, labelStyle, maxLines = 1, softWrap = false).size.width } ?: 0
            val step = with(LocalDensity.current) { labelStep(widest.toFloat(), column.toPx(), gap.toPx()) }
            Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
                repeat(ChartMonths) { slot ->
                    // Fewer than twelve months sit at the right, lined up with the chart above, as on the web.
                    val index = slot - (ChartMonths - months.size)
                    val month = months.getOrNull(index)
                    val chosen = month != null && month == selected
                    val named = month != null && (ChartMonths - 1 - slot) % step == 0
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            // A shaped background, not a clip, so a month's name may run past its column.
                            .background(if (chosen) palette.accentSoft else Color.Transparent, RoundedCornerShape(6.dp))
                            .padding(vertical = 4.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        // With amounts hidden the bars are not drawn either, so their shape gives nothing away.
                        Canvas(modifier = Modifier.fillMaxWidth().height(ChartHeight)) { if (month != null && !hidden) bars(index) }
                        Text(
                            if (named) names[index] else "",
                            style = labelStyle.copy(fontWeight = if (chosen) FontWeight.SemiBold else FontWeight.Normal),
                            color = if (chosen) palette.text else palette.muted,
                            maxLines = 1,
                            softWrap = false,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.wrapContentWidth(unbounded = true),
                        )
                    }
                }
            }
        }
    }
}

/** Money in and spending for each month: two bars per month, the accent for money in and grey for spending. */
@Composable
internal fun CashFlowChart(report: CashFlowReport, selected: String, open: Boolean, onToggle: () -> Unit) {
    val palette = LocalPalette.current
    val peak = report.months.maxOfOrNull { maxOf(it.income.amount, it.spending.amount) }?.coerceAtLeast(0L) ?: 0L
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ChartCard(stringResource(R.string.insights_flow_chart), report.months.map { it.month }, selected) { index ->
            val row = report.months[index]
            val width = min((size.width * 0.4f).toDp(), 12.dp).toPx()
            val gap = 2.dp.toPx()
            val left = size.width / 2 - gap / 2 - width
            topRoundedBar(left, width, flowHeight(row.income.amount, peak), palette.accent)
            topRoundedBar(size.width / 2 + gap / 2, width, flowHeight(row.spending.amount, peak), palette.muted)
        }
        Row(modifier = Modifier.padding(horizontal = ScreenMargin), verticalAlignment = Alignment.CenterVertically) {
            Key(palette.accent)
            Small(stringResource(R.string.insights_money_in))
            Spacer(Modifier.width(12.dp))
            Key(palette.muted)
            Small(stringResource(R.string.insights_spending))
        }
        HiddenNote()
        Figures(open, onToggle) {
            BoxWithConstraints {
                // Four columns fit a phone at the usual text size; narrower or with larger text, each month is a line.
                val table = maxWidth >= 300.dp * LocalDensity.current.fontScale.coerceAtLeast(1f)
                Column {
                    if (table) {
                        FigureRow(listOf(stringResource(R.string.insights_month), stringResource(R.string.insights_in), stringResource(R.string.insights_out), stringResource(R.string.insights_net)), header = true)
                        HorizontalDivider(color = palette.border)
                    }
                    report.months.reversed().forEachIndexed { index, row ->
                        if (index > 0) HorizontalDivider(color = palette.border)
                        val name = "${shortMonth(row.month)} ${row.month.take(4)}"
                        val income = money(row.income.amount, row.income.currency)
                        val spending = money(row.spending.amount, row.spending.currency)
                        val net = money(row.net.amount, row.net.currency)
                        val spoken = stringResource(R.string.insights_flow_row, name, income.spoken, spending.spoken, net.spoken)
                        Box(modifier = Modifier.clearAndSetSemantics { contentDescription = spoken }) {
                            if (table) {
                                FigureRow(listOf(name, income.text, spending.text, net.text))
                            } else {
                                Column(modifier = Modifier.padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Text(name, style = FigureStyle())
                                    Text(stringResource(R.string.insights_flow_line, income.text, spending.text, net.text), style = FigureStyle(), color = palette.muted)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Net worth at each month end: one bar per month, a line at zero when a month is below it, hatched when incomplete. */
@Composable
internal fun NetWorthChart(report: NetWorthReport, selected: String, open: Boolean, onToggle: () -> Unit) {
    val palette = LocalPalette.current
    val count = report.months.size
    val history = report.historyStart?.takeIf { count < ChartMonths }?.let {
        stringResource(R.string.insights_history_starts, monthLabel(it))
    }
    if (count == 0) {
        history?.let { Note(it) }
        return
    }
    val scale = WorthScale(report.months.map { it.netWorth.amount })
    val incomplete = report.months.filter { it.unconvertedCurrencies.isNotEmpty() }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ChartCard(pluralStringResource(R.plurals.insights_worth_chart, count, count), report.months.map { it.month }, selected) { index ->
            val row = report.months[index]
            scale.zero?.let { zero ->
                val y = size.height * (1 - zero)
                drawLine(palette.border, Offset(0f, y), Offset(size.width, y), strokeWidth = 1.dp.toPx())
            }
            val bar = scale.bar(row.netWorth.amount)
            val width = min((size.width * 0.6f).toDp(), 16.dp).toPx()
            val top = size.height * (1 - bar.bottom - bar.height)
            val corner = CornerRadius(2.dp.toPx())
            val at = Offset((size.width - width) / 2, top)
            val box = Size(width, size.height * bar.height)
            if (row.unconvertedCurrencies.isEmpty()) {
                drawRoundRect(palette.accent, at, box, corner)
            } else {
                hatch(at, box, palette.accent, palette.accentSoft)
                drawRoundRect(palette.accent, at, box, corner, style = Stroke(1.dp.toPx()))
            }
        }
        history?.let { Note(it) }
        if (incomplete.isNotEmpty()) {
            val missing = incomplete.flatMap { it.unconvertedCurrencies }.groupingBy { it }.eachCount()
            val list = missing.entries.map { (code, months) -> stringResource(R.string.insights_missing_rate, code, months, count) }.joinToString(", ")
            Row(modifier = Modifier.padding(horizontal = ScreenMargin), verticalAlignment = Alignment.Top) {
                Canvas(modifier = Modifier.padding(top = 3.dp, end = 6.dp).size(10.dp)) { hatch(Offset.Zero, size, palette.accent, palette.accentSoft) }
                Small(stringResource(R.string.insights_incomplete, list))
            }
        }
        HiddenNote()
        Figures(open, onToggle) {
            report.months.reversed().forEachIndexed { index, row ->
                if (index > 0) HorizontalDivider(color = palette.border)
                WorthRow(row)
            }
        }
    }
}

@Composable
private fun WorthRow(row: NetWorthMonth) {
    val name = "${shortMonth(row.month)} ${row.month.take(4)}"
    val worth = money(row.netWorth.amount, row.netWorth.currency)
    val without = row.unconvertedCurrencies.takeIf { it.isNotEmpty() }?.let { stringResource(R.string.insights_without, it.joinToString(", ")) }
    val spoken = listOfNotNull("$name: ${worth.spoken}", without).joinToString(" ")
    Box(modifier = Modifier.padding(vertical = 8.dp).clearAndSetSemantics { contentDescription = spoken }) {
        TitleAndAmount(
            title = { Text(name, style = FigureStyle()) },
            amount = {
                Column(horizontalAlignment = Alignment.End) {
                    Text(worth.text, style = FigureStyle(), maxLines = 1, softWrap = false)
                    if (without != null) Text(without, style = FigureStyle(), color = LocalPalette.current.muted)
                }
            },
        )
    }
}

/** `.flow-details`: "Show the figures", a bordered row that opens to the chart's numbers. */
@Composable
private fun Figures(open: Boolean, onToggle: () -> Unit, content: @Composable () -> Unit) {
    val palette = LocalPalette.current
    val state = stringResource(if (open) R.string.expanded else R.string.collapsed)
    Surface(
        modifier = Modifier.fillMaxWidth().padding(horizontal = ScreenMargin),
        shape = MaterialTheme.shapes.medium,
        color = palette.surface,
        border = BorderStroke(1.dp, palette.border),
    ) {
        Column {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onToggle)
                    .semantics {
                        role = Role.Button
                        stateDescription = state
                    }
                    .heightIn(min = 48.dp)
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    painterResource(R.drawable.ic_chevron_right),
                    contentDescription = null,
                    modifier = Modifier.size(20.dp).rotate(if (open) 90f else 0f),
                )
                Spacer(Modifier.width(12.dp))
                Text(stringResource(R.string.insights_show_figures), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium))
            }
            if (open) {
                Column(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp)) { content() }
            }
        }
    }
}

@Composable
private fun FigureRow(cells: List<String>, header: Boolean = false) {
    Row(modifier = Modifier.padding(vertical = 8.dp)) {
        cells.forEachIndexed { index, cell ->
            Text(
                cell,
                style = FigureStyle(),
                color = if (header) LocalPalette.current.muted else LocalPalette.current.text,
                textAlign = if (index == 0) TextAlign.Start else TextAlign.End,
                maxLines = 1,
                softWrap = false,
                modifier = Modifier.weight(if (index == 0) 1.1f else 1f),
            )
        }
    }
}

/** `.flow-table`: 13 sp with tabular figures. */
@Composable
private fun FigureStyle() = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.sp).tabular()

/** With amounts hidden, says why the chart has no bars. */
@Composable
private fun HiddenNote() {
    if (LocalPrivacy.current) Note(stringResource(R.string.insights_charts_hidden))
}

@Composable
private fun Note(text: String) {
    Small(text, modifier = Modifier.padding(horizontal = ScreenMargin))
}

@Composable
private fun Small(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = modifier)
}

/** `.flow-key`: a 10 dp square in a chart's colour. */
@Composable
private fun Key(color: Color) {
    Box(modifier = Modifier.padding(end = 6.dp).size(10.dp).clip(RoundedCornerShape(2.dp)).background(color))
}

/** A bar from the bottom, [share] of the height, rounded only at the top (`border-radius: 2px 2px 0 0`). */
private fun DrawScope.topRoundedBar(left: Float, width: Float, share: Float, color: Color) {
    if (share <= 0f) return
    val height = size.height * share
    val corner = 2.dp.toPx()
    clipRect(left = left, top = size.height - height, right = left + width, bottom = size.height) {
        drawRoundRect(color, Offset(left, size.height - height), Size(width, height + corner), CornerRadius(corner))
    }
}

/** `.nw-partial`: 135° stripes of the accent and its soft fill, 3 dp each. */
private fun DrawScope.hatch(at: Offset, box: Size, accent: Color, soft: Color) {
    val stripe = 3.dp.toPx()
    clipRect(at.x, at.y, at.x + box.width, at.y + box.height) {
        drawRect(soft, at, box)
        var x = at.x - box.height
        while (x < at.x + box.width) {
            drawLine(accent, Offset(x, at.y + box.height), Offset(x + box.height, at.y), strokeWidth = stripe)
            x += stripe * 2 * 1.414f
        }
    }
}
