package app.ledgerline.android.ui.design

import app.ledgerline.android.ui.home.BAR_LABEL_FLOOR_DP
import app.ledgerline.android.ui.home.smallestBarLabel
import app.ledgerline.android.ui.theme.TEXT_FLOOR_SP
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Nothing is set in type smaller than the floor, 10 sp (ADR 0046, amended); the bottom bar's labels may shrink further only for a larger phone text setting, floored at 10 dp of height. */
class TextFloorTest {
    private val sources = File("src/main/kotlin").walkTopDown().filter { it.extension == "kt" }.toList()

    /** Every size written in the code: `12.sp` (not a letter spacing), `inter(12, ...)`. */
    private fun sizes(text: String): List<Double> =
        Regex("""(?<!letterSpacing = )(\d+(?:\.\d+)?)\.sp""").findAll(text).map { it.groupValues[1].toDouble() }.toList() +
            Regex("""\binter\((\d+)""").findAll(text).map { it.groupValues[1].toDouble() }.toList()

    @Test
    fun noTextSizeInTheCodeIsUnderTheFloor() {
        assertTrue("no sources found", sources.isNotEmpty())
        val small = sources.flatMap { file -> sizes(file.readText()).filter { it < TEXT_FLOOR_SP }.map { "${file.name}: $it" } }
        assertTrue("under $TEXT_FLOOR_SP sp: $small", small.isEmpty())
    }

    @Test
    fun theBarLabelFloorIsTenDpOfHeightWhateverTheFontScale() {
        assertEquals(10f, BAR_LABEL_FLOOR_DP)
        assertEquals(10f, smallestBarLabel(1f), 0.001f)
        assertEquals(5f, smallestBarLabel(2f), 0.001f)
    }
}
