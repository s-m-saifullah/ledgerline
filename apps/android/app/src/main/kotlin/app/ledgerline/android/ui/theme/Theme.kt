package app.ledgerline.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

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
    )
    MaterialTheme(colorScheme = colors, content = content)
}
