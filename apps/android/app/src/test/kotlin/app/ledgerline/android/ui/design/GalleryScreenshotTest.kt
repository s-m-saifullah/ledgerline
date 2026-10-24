package app.ledgerline.android.ui.design

import android.app.Application
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.ledgerline.android.ui.theme.LedgerlineTheme
import app.ledgerline.android.ui.theme.LocalPalette
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The redesign's building blocks side by side (ADR 0046), at 320 and 390 dp, light and dark, and with the largest
 * font scale. Runs only with -Pledgerline.screenshots; the names and figures are made up.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class)
class GalleryScreenshotTest(private val width: Int, private val dark: Boolean, private val fontScale: Float) {
    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}dp dark={1} font={2}")
        fun cases() = listOf(
            arrayOf<Any>(320, false, 1f),
            arrayOf<Any>(390, false, 1f),
            arrayOf<Any>(320, true, 1f),
            arrayOf<Any>(390, true, 1f),
            arrayOf<Any>(390, false, 2f),
        )
    }

    @Before
    fun screen() {
        assumeTrue("screenshots run with -Pledgerline.screenshots", System.getProperty("ledgerline.screenshots") == "true")
        RuntimeEnvironment.setQualifiers("w${width}dp-h1500dp-xxhdpi")
        RuntimeEnvironment.setFontScale(fontScale)
    }

    @Test
    fun gallery() {
        val theme = if (dark) "dark" else "light"
        captureRoboImage("build/outputs/roborazzi/gallery-${width}dp-$theme-font$fontScale.png") {
            LedgerlineTheme(darkTheme = dark) { Surface(color = MaterialTheme.colorScheme.background) { Gallery() } }
        }
    }
}

@Composable
private fun Gallery() {
    var kind by remember { mutableIntStateOf(0) }
    var chip by remember { mutableStateOf(true) }
    Column(modifier = Modifier.verticalScroll(rememberScrollState()).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        TopBar("Clients", onBack = {}, action = { Text("Add", color = LocalPalette.current.accent) })
        SegmentedControl(listOf("Expense (9)", "Income (3)"), kind, { kind = it }, Modifier.padding(horizontal = ScreenMargin))
        Row(modifier = Modifier.padding(horizontal = ScreenMargin), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip("Open", chip) { chip = !chip }
            FilterChip("Settled", !chip) { chip = !chip }
        }
        SectionLabel("Ranked by balance owed")
        GroupedListCard {
            row { ListRow("Studio 6", "Oldest unpaid: 12 Oct", leading = { Avatar("Studio 6") }, trailing = { Text("\$252.00", style = MaterialTheme.typography.titleMedium) }, onClick = {}) }
            row { ListRow("North Wind Trading", "Oldest unpaid: 23 Oct", leading = { Avatar("North Wind Trading") }, trailing = { Text("\$72.00", style = MaterialTheme.typography.titleMedium) }, onClick = {}) }
            row { ListRow("Rafia", leading = { Avatar("Rafia") }, onClick = {}) }
        }
        SectionLabel("Budget")
        LedgerCard {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Within (60%)"); ProportionBar(0.6f, limitState(60, 100))
                Text("Near (96%)"); ProportionBar(0.96f, limitState(96, 100))
                Text("Over (100%+)"); ProportionBar(1f, limitState(120, 100))
            }
        }
        SectionLabel("Spending by category")
        LedgerCard {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SegmentedBar(listOf(0.30f, 0.22f, 0.16f, 0.12f, 0.09f, 0.07f, 0.04f))
                Text("Tints of the accent, then the neutral; each part is named in its row.", style = MaterialTheme.typography.bodySmall, color = LocalPalette.current.muted)
            }
        }
        EmptyState("No clients yet.", "Add a client" to {})
    }
}
