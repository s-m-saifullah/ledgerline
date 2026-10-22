package app.ledgerline.android.ui.format

import java.math.BigDecimal
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Currency
import java.util.Locale

/**
 * Formats integer minor units for display, exactly (through BigDecimal, never floating point). The number of
 * decimals is the currency's own (on Android from ICU's CLDR data, as the server's `Intl` uses).
 */
fun formatMoney(amount: Long, code: String, locale: Locale = Locale.getDefault()): String {
    val currency = try {
        Currency.getInstance(code)
    } catch (_: IllegalArgumentException) {
        null
    }
    val digits = currency?.defaultFractionDigits?.takeIf { it >= 0 } ?: 2
    val value = BigDecimal.valueOf(amount, digits)
    if (currency == null) {
        val plain = NumberFormat.getNumberInstance(locale).apply {
            minimumFractionDigits = digits
            maximumFractionDigits = digits
        }
        return "$code ${plain.format(value)}"
    }
    return NumberFormat.getCurrencyInstance(locale).apply {
        this.currency = currency
        minimumFractionDigits = digits
        maximumFractionDigits = digits
    }.format(value)
}

/** "10:42" today, otherwise a short date and time, in the phone's time zone. */
fun formatUpdated(serverTime: String, zone: ZoneId = ZoneId.systemDefault(), today: LocalDate = LocalDate.now(zone), locale: Locale = Locale.getDefault()): String {
    val at = Instant.parse(serverTime).atZone(zone)
    val style = if (at.toLocalDate() == today) {
        DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)
    } else {
        DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
    }
    return at.format(style.withLocale(locale))
}

/** An entry's date ("2026-10-20") as a medium date. */
fun formatEntryDate(date: String, locale: Locale = Locale.getDefault()): String =
    LocalDate.parse(date).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))
