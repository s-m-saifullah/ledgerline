package app.ledgerline.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.ledgerline.android.R

/** The tokens Material has no slot for (the border, the accent's soft fill, positive): read by ui/design. */
val LocalPalette = staticCompositionLocalOf { LightPalette }

/** Inter 4.1, the variable font the web also uses (self-hosted there), at the web's four weights (ADR 0045). */
@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
val Inter = FontFamily(
    listOf(400, 500, 600, 700).map { weight ->
        Font(R.font.inter_variable, FontWeight(weight), variationSettings = FontVariation.Settings(FontVariation.weight(weight)))
    },
)

private fun inter(size: Int, weight: Int, lineHeight: Double = 1.4, spacing: Double = 0.0) = TextStyle(
    fontFamily = Inter,
    fontWeight = FontWeight(weight),
    fontSize = size.sp,
    lineHeight = (size * lineHeight).sp,
    letterSpacing = spacing.em,
)

/**
 * The web's sizes in sp (ADR 0045), with the redesign's floor (ADR 0046): the page title 28, section titles 20,
 * body 16, muted text 14, card labels and section labels 12 (the smallest text anywhere); amounts 32 and the In
 * hand amount 36, with tabular figures where shown.
 */
val LedgerlineTypography = Typography(
    displayMedium = inter(36, 600, lineHeight = 1.15, spacing = -0.02),
    displaySmall = inter(32, 600, lineHeight = 1.15, spacing = -0.02),
    headlineMedium = inter(28, 600, lineHeight = 1.2, spacing = -0.045),
    titleLarge = inter(20, 600, lineHeight = 1.3, spacing = -0.025),
    titleMedium = inter(16, 600),
    titleSmall = inter(14, 600),
    bodyLarge = inter(16, 400, lineHeight = 1.5),
    bodyMedium = inter(14, 400, lineHeight = 1.6),
    bodySmall = inter(12, 400, lineHeight = 1.5),
    labelLarge = inter(14, 500),
    labelMedium = inter(12, 500),
    labelSmall = inter(12, 600, spacing = 0.08),
)

/** Corners (ADR 0046): 8 for small marks, 12 for fields and buttons, 16 for cards, 20 for the hero, 24 for sheets and dialogs. */
val LedgerlineShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(24.dp),
)

/**
 * Material 3 colours taken from the shared design tokens (LedgerlinePalette.kt is generated from the web
 * app's tokens.css): zinc surfaces, one teal accent, red only for errors and Delete.
 */
@Composable
fun LedgerlineTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val colors = if (darkTheme) darkColorScheme(
        primary = DarkPalette.accent,
        onPrimary = DarkPalette.accentForeground,
        primaryContainer = DarkPalette.accentSoft,
        onPrimaryContainer = DarkPalette.text,
        background = DarkPalette.background,
        onBackground = DarkPalette.text,
        surface = DarkPalette.surface,
        onSurface = DarkPalette.text,
        onSurfaceVariant = DarkPalette.muted,
        outline = DarkPalette.fieldBorder,
        outlineVariant = DarkPalette.border,
        error = DarkPalette.danger,
        onError = DarkPalette.dangerForeground,
        // Bars, menus and sheets sit on the surface colour, as the web's do.
        // One accent: Material's secondary and tertiary roles take the teal too, so its default purple never shows.
        secondary = DarkPalette.accent,
        onSecondary = DarkPalette.accentForeground,
        secondaryContainer = DarkPalette.accentSoft,
        onSecondaryContainer = DarkPalette.text,
        tertiary = DarkPalette.accent,
        onTertiary = DarkPalette.accentForeground,
        tertiaryContainer = DarkPalette.accentSoft,
        onTertiaryContainer = DarkPalette.text,
        surfaceContainer = DarkPalette.surface,
        surfaceContainerLow = DarkPalette.surface,
        surfaceContainerHigh = DarkPalette.surface,
        surfaceContainerHighest = DarkPalette.surface,
    ) else lightColorScheme(
        primary = LightPalette.accent,
        onPrimary = LightPalette.accentForeground,
        primaryContainer = LightPalette.accentSoft,
        onPrimaryContainer = LightPalette.text,
        background = LightPalette.background,
        onBackground = LightPalette.text,
        surface = LightPalette.surface,
        onSurface = LightPalette.text,
        onSurfaceVariant = LightPalette.muted,
        outline = LightPalette.fieldBorder,
        outlineVariant = LightPalette.border,
        error = LightPalette.danger,
        onError = LightPalette.dangerForeground,
        // One accent: Material's secondary and tertiary roles take the teal too, so its default purple never shows.
        secondary = LightPalette.accent,
        onSecondary = LightPalette.accentForeground,
        secondaryContainer = LightPalette.accentSoft,
        onSecondaryContainer = LightPalette.text,
        tertiary = LightPalette.accent,
        onTertiary = LightPalette.accentForeground,
        tertiaryContainer = LightPalette.accentSoft,
        onTertiaryContainer = LightPalette.text,
        surfaceContainer = LightPalette.surface,
        surfaceContainerLow = LightPalette.surface,
        surfaceContainerHigh = LightPalette.surface,
        surfaceContainerHighest = LightPalette.surface,
    )
    CompositionLocalProvider(LocalPalette provides if (darkTheme) DarkPalette else LightPalette) {
        MaterialTheme(colorScheme = colors, typography = LedgerlineTypography, shapes = LedgerlineShapes, content = content)
    }
}
