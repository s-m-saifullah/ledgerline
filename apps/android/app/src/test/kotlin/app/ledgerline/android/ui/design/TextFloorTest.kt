package app.ledgerline.android.ui.design

import app.ledgerline.android.ui.home.BAR_LABEL_FLOOR_DP
import app.ledgerline.android.ui.home.smallestBarLabel
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Nothing is set in type smaller than 12 sp (ADR 0046); the one exception is the bottom bar's labels, floored at 11 dp of height. */
class TextFloorTest {
    private val sources = File("src/main/kotlin").walkTopDown().filter { it.extension == "kt" }.toList()

    /** Every size written in the code: `12.sp` (not a letter spacing), `inter(12, ...)`. */
    private fun sizes(text: String): List<Double> =
        Regex("""(?<!letterSpacing = )(\d+(?:\.\d+)?)\.sp""").findAll(text).map { it.groupValues[1].toDouble() }.toList() +
            Regex("""\binter\((\d+)""").findAll(text).map { it.groupValues[1].toDouble() }.toList()

    @Test
    fun noTextSizeInTheCodeIsUnderTwelve() {
        assertTrue("no sources found", sources.isNotEmpty())
        val small = sources.flatMap { file -> sizes(file.readText()).filter { it < 12.0 }.map { "${file.name}: $it" } }
        assertTrue("under 12 sp: $small", small.isEmpty())
    }

    @Test
    fun theBarLabelFloorIsElevenDpOfHeightWhateverTheFontScale() {
        assertEquals(11f, BAR_LABEL_FLOOR_DP)
        assertEquals(11f, smallestBarLabel(1f), 0.001f)
        assertEquals(5.5f, smallestBarLabel(2f), 0.001f)
    }
}
