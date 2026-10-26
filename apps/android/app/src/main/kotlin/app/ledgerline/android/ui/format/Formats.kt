package app.ledgerline.android.ui.format

import java.math.BigDecimal
import java.math.RoundingMode
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
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

/** "Oct 12" for "2026-10-12", in the phone's language: a date in a row's hint, where the year is left out. */
fun formatShortDate(date: String, locale: Locale = Locale.getDefault()): String =
    LocalDate.parse(date).format(DateTimeFormatter.ofPattern("MMM d", locale))

/** "October 2026" for "2026-10", in the phone's language. */
fun monthLabel(month: String, locale: Locale = Locale.getDefault()): String =
    YearMonth.parse(month).format(DateTimeFormatter.ofPattern("LLLL yyyy", locale))

/** "Oct" for "2026-10", in the phone's language: the label under a month in a chart. */
fun shortMonth(month: String, locale: Locale = Locale.getDefault()): String =
    YearMonth.parse(month).format(DateTimeFormatter.ofPattern("LLL", locale))

/** "23.7%" for a part of a whole in minor units, one decimal as on the web; "0.0%" when there is no whole. */
fun sharePercent(part: Long, whole: Long, locale: Locale = Locale.getDefault()): String {
    val format = NumberFormat.getPercentInstance(locale).apply {
        minimumFractionDigits = 1
        maximumFractionDigits = 1
    }
    if (whole <= 0) return format.format(0)
    // Rounded once, half up, to a tenth of a percent (three decimals of the fraction), as the web's toFixed(1).
    return format.format(BigDecimal.valueOf(part).divide(BigDecimal.valueOf(whole), 3, RoundingMode.HALF_UP))
}

/** "2:30 PM" (or "14:30", by the phone's language) for a service's `HH:mm` time. */
fun formatServiceTime(time: String, locale: Locale = Locale.getDefault()): String =
    java.time.LocalTime.parse(time).format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale))

/** A moment from the server (UTC) as the phone's local date and time, as the web's `toLocaleString`. */
fun formatMoment(serverTime: String, zone: ZoneId = ZoneId.systemDefault(), locale: Locale = Locale.getDefault()): String =
    Instant.parse(serverTime).atZone(zone).format(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withLocale(locale))

/** "Oct 23, 4:01 PM": a moment from the server in the phone's time zone, without the year, for a row's hint. */
fun formatMomentShort(serverTime: String, zone: ZoneId = ZoneId.systemDefault(), locale: Locale = Locale.getDefault()): String {
    val at = Instant.parse(serverTime).atZone(zone)
    return at.format(DateTimeFormatter.ofPattern("MMM d, ", locale)) + at.format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale))
}
