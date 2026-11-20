package app.ledgerline.android.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The phone's type scale (ADR 0046, amended): every size under the web's, and none under the floor. */
class TypeScaleTest {
    private val t = LedgerlineTypography

    @Test
    fun theFloorIsTenSp() {
        assertEquals(10, TEXT_FLOOR_SP)
    }

    @Test
    fun eachStyleHasItsSize() {
        val sizes = mapOf(
            "displayMedium" to t.displayMedium.fontSize.value,
            "displaySmall" to t.displaySmall.fontSize.value,
            "headlineMedium" to t.headlineMedium.fontSize.value,
            "titleLarge" to t.titleLarge.fontSize.value,
            "titleMedium" to t.titleMedium.fontSize.value,
            "titleSmall" to t.titleSmall.fontSize.value,
            "bodyLarge" to t.bodyLarge.fontSize.value,
            "bodyMedium" to t.bodyMedium.fontSize.value,
            "bodySmall" to t.bodySmall.fontSize.value,
            "labelLarge" to t.labelLarge.fontSize.value,
            "labelMedium" to t.labelMedium.fontSize.value,
            "labelSmall" to t.labelSmall.fontSize.value,
        )
        val expected = mapOf(
            "displayMedium" to 35f, "displaySmall" to 31f, "headlineMedium" to 27f, "titleLarge" to 19f,
            "titleMedium" to 14f, "titleSmall" to 12f, "bodyLarge" to 14f, "bodyMedium" to 12f,
            "bodySmall" to 10f, "labelLarge" to 12f, "labelMedium" to 10f, "labelSmall" to 10f,
        )
        assertEquals(expected, sizes)
    }

    @Test
    fun noStyleIsUnderTheFloor() {
        listOf(t.displayMedium, t.displaySmall, t.headlineMedium, t.titleLarge, t.titleMedium, t.titleSmall, t.bodyLarge, t.bodyMedium, t.bodySmall, t.labelLarge, t.labelMedium, t.labelSmall)
            .forEach { assertTrue("${it.fontSize}", it.fontSize.value >= TEXT_FLOOR_SP) }
    }

    @Test
    fun lineHeightsFollowTheSize() {
        assertEquals(14f * 1.5f, t.bodyLarge.lineHeight.value, 0.01f)
        assertEquals(12f * 1.6f, t.bodyMedium.lineHeight.value, 0.01f)
        assertEquals(10f * 1.5f, t.bodySmall.lineHeight.value, 0.01f)
    }

    /** Every text style Material can ask for, found by reflection so a slot Material adds later cannot slip in. */
    private fun everySlot(typography: Typography): Map<String, TextStyle> =
        Typography::class.java.methods
            .filter { it.name.startsWith("get") && it.parameterCount == 0 && TextStyle::class.java.isAssignableFrom(it.returnType) }
            .associate { it.name.removePrefix("get") to (it.invoke(typography) as TextStyle) }

    @Test
    fun everyMaterialSlotIsDefinedByUsAndNotLeftToMaterial() {
        val ours = everySlot(t)
        val materials = everySlot(Typography())
        assertTrue("found ${ours.size} slots", ours.size >= 15)
        // A slot left at Material's default (24 sp and larger, the system font) differs from ours only if we set it.
        val left = ours.filter { (name, style) -> style == materials[name] }.keys
        assertEquals("slots left at Material's default", emptySet<String>(), left)
    }

    @Test
    fun everySlotIsInterOnTheScale() {
        val scale = setOf(35f, 31f, 27f, 19f, 14f, 12f, 10f)
        everySlot(t).forEach { (name, style) ->
            assertEquals("$name font", Inter, style.fontFamily)
            assertTrue("$name is ${style.fontSize.value} sp", style.fontSize.value in scale)
        }
    }

    @Test
    fun theDialogTitleIsTheSectionTitleAndThePickersUseTheBigSizes() {
        assertEquals(t.titleLarge.fontSize, t.headlineSmall.fontSize)
        assertEquals(31f, t.headlineLarge.fontSize.value)
        assertEquals(35f, t.displayLarge.fontSize.value)
    }
}
