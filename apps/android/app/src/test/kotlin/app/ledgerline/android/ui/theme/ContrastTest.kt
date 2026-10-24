package app.ledgerline.android.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import org.junit.Assert.assertTrue
import org.junit.Test

/** WCAG AA for the palettes (ADR 0046): text pairs at 4.5:1, outlines, icons and chart steps at 3:1, in light and dark. */
class ContrastTest {
    private fun ratio(a: Color, b: Color): Double {
        val (hi, lo) = listOf(a.luminance(), b.luminance()).sortedDescending()
        return (hi + 0.05) / (lo + 0.05)
    }

    private fun atLeast(min: Double, name: String, a: Color, b: Color, failures: MutableList<String>) {
        val value = ratio(a, b)
        if (value < min) failures += "$name ${"%.2f".format(value)} < $min"
    }

    private fun check(theme: String, p: LedgerlinePalette): List<String> {
        val failures = mutableListOf<String>()
        fun text(name: String, a: Color, b: Color) = atLeast(4.5, "$theme $name", a, b, failures)
        fun graphic(name: String, a: Color, b: Color) = atLeast(3.0, "$theme $name", a, b, failures)
        text("text on background", p.text, p.background)
        text("text on surface", p.text, p.surface)
        text("text on accent soft", p.text, p.accentSoft)
        text("muted on background", p.muted, p.background)
        text("muted on surface", p.muted, p.surface)
        text("muted on accent soft", p.muted, p.accentSoft)
        text("accent on background", p.accent, p.background)
        text("accent on surface", p.accent, p.surface)
        text("accent on accent soft", p.accent, p.accentSoft)
        text("accent foreground on accent", p.accentForeground, p.accent)
        text("hero text on accent deep", p.accentDeepForeground, p.accentDeep)
        text("danger on surface", p.danger, p.surface)
        text("danger on background", p.danger, p.background)
        text("danger foreground on danger", p.dangerForeground, p.danger)
        text("positive on surface", p.positive, p.surface)
        text("warning on surface", p.warning, p.surface)
        graphic("field border on surface", p.fieldBorder, p.surface)
        graphic("field border on background", p.fieldBorder, p.background)
        graphic("neutral chart part on surface", p.fieldBorder, p.surface)
        listOf(p.chart1, p.chart2, p.chart3, p.chart4, p.chart5).forEachIndexed { i, c ->
            graphic("chart step ${i + 1} on surface", c, p.surface)
        }
        graphic("accent on surface (icons, bars)", p.accent, p.surface)
        graphic("danger on surface (bars)", p.danger, p.surface)
        graphic("warning on surface (bars)", p.warning, p.surface)
        return failures
    }

    @Test
    fun lightPaletteMeetsAA() {
        val failures = check("light", LightPalette)
        assertTrue(failures.joinToString("; "), failures.isEmpty())
    }

    @Test
    fun darkPaletteMeetsAA() {
        val failures = check("dark", DarkPalette)
        assertTrue(failures.joinToString("; "), failures.isEmpty())
    }
}
