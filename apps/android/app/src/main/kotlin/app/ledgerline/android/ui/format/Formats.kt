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

/** How one currency is written in one locale: the formatter, the currency's own decimals and, for an unknown code, its prefix. */
internal class MoneyStyle(val format: NumberFormat, val digits: Int, val prefix: String)

private fun buildMoneyStyle(code: String, locale: Locale): MoneyStyle {
    val currency = try {
        Currency.getInstance(code)
    } catch (_: IllegalArgumentException) {
        null
    }
    val digits = currency?.defaultFractionDigits?.takeIf { it >= 0 } ?: 2
    val format = if (currency == null) NumberFormat.getNumberInstance(locale) else NumberFormat.getCurrencyInstance(locale).apply { this.currency = currency }
    format.minimumFractionDigits = digits
    format.maximumFractionDigits = digits
    return MoneyStyle(format, digits, if (currency == null) "$code " else "")
}

/**
 * One formatter per locale and currency and per thread, built on first use: building one is the slow part of showing an
 * amount, and a list shows hundreds. A `NumberFormat` is not safe to share between threads, so each thread keeps its own.
 */
private val moneyStyles: ThreadLocal<HashMap<Pair<Locale, String>, MoneyStyle>> = ThreadLocal.withInitial { HashMap() }

internal fun moneyStyle(code: String, locale: Locale): MoneyStyle =
    moneyStyles.get()!!.getOrPut(locale to code) { buildMoneyStyle(code, locale) }

/**
 * Formats integer minor units for display, exactly (through BigDecimal, never floating point). The number of
 * decimals is the currency's own (on Android from ICU's CLDR data, as the server's `Intl` uses).
 */
fun formatMoney(amount: Long, code: String, locale: Locale = Locale.getDefault()): String {
    val style = moneyStyle(code, locale)
    return style.prefix + style.format.format(BigDecimal.valueOf(amount, style.digits))
}

/**
 * A date or time pattern in the phone's language and order, built from a skeleton ("MMMd", "yMMMEd", "Hm") by the phone's
 * own date library, so a UK phone writes "22 Oct", a German one "22. Okt." and a Japanese one "10月22日". One formatter per
 * locale and skeleton: building one is the slow part, and a list shows hundreds of dates. A `DateTimeFormatter` is
 * immutable, so it is shared between threads.
 */
private val formatters = java.util.concurrent.ConcurrentHashMap<Pair<Locale, String>, DateTimeFormatter>()

internal fun formatterFor(locale: Locale, skeleton: String): DateTimeFormatter = formatters.getOrPut(locale to skeleton) {
    val pattern = android.text.format.DateFormat.getBestDateTimePattern(locale, skeleton)
    try {
        DateTimeFormatter.ofPattern(pattern, locale)
    } catch (_: IllegalArgumentException) {
        // A letter the pattern uses that java.time does not know: the language's own medium style instead.
        DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)
    }
}

private fun clockSkeleton(is24Hour: Boolean) = if (is24Hour) "Hm" else "hm"

/**
 * "10:42" today, otherwise the day and time: "Oct 21, 5:42 AM", with the year when it is not this year; the time follows
 * the phone's 24-hour setting.
 */
fun formatUpdated(
    serverTime: String,
    zone: ZoneId = ZoneId.systemDefault(),
    today: LocalDate = LocalDate.now(zone),
    is24Hour: Boolean = false,
    locale: Locale = Locale.getDefault(),
): String {
    val at = Instant.parse(serverTime).atZone(zone)
    if (at.toLocalDate() == today) return at.format(formatterFor(locale, clockSkeleton(is24Hour)))
    return formatServerMoment(serverTime, today, is24Hour, zone, locale)
}

/** A picked date ("2026-10-20") as a medium date, always with its year: what a date pill or a rate's date shows. */
fun formatEntryDate(date: String, locale: Locale = Locale.getDefault()): String =
    LocalDate.parse(date).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))

/**
 * A day as every row hint writes it, as the web does: "Oct 12" for this year, "Dec 31, 2025" (the year) for another, in the
 * phone's language and order. [today] decides what this year is.
 */
fun formatDay(date: String, today: LocalDate, locale: Locale = Locale.getDefault()): String {
    val day = LocalDate.parse(date)
    return day.format(formatterFor(locale, if (day.year == today.year) "MMMd" else "yMMMd"))
}

/** A day heading, with its weekday and always its year: "Thu, Oct 22, 2026", in the phone's language and order. */
fun formatDayHead(date: String, locale: Locale = Locale.getDefault()): String =
    LocalDate.parse(date).format(formatterFor(locale, "yMMMEd"))

/** "October 2026" for "2026-10", in the phone's language and order. */
fun monthLabel(month: String, locale: Locale = Locale.getDefault()): String =
    YearMonth.parse(month).format(formatterFor(locale, "yMMMM"))

/** "Oct" for "2026-10", in the phone's language: the label under a month in a chart. */
fun shortMonth(month: String, locale: Locale = Locale.getDefault()): String =
    YearMonth.parse(month).format(formatterFor(locale, "MMM"))

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

/** A time of day (`HH:mm`) as the phone shows times: "15:05" with the 24-hour setting, "3:05 PM" without, in the phone's language. */
fun formatClock(time: String, is24Hour: Boolean, locale: Locale = Locale.getDefault()): String =
    java.time.LocalTime.parse(time).format(formatterFor(locale, clockSkeleton(is24Hour)))

/**
 * "Oct 23, 4:01 PM": a moment from the server in the phone's time zone, with the year when it is not this year, and the
 * time by the phone's 24-hour setting.
 */
fun formatServerMoment(
    serverTime: String,
    today: LocalDate,
    is24Hour: Boolean,
    zone: ZoneId = ZoneId.systemDefault(),
    locale: Locale = Locale.getDefault(),
): String {
    val at = Instant.parse(serverTime).atZone(zone)
    val year = if (at.year == today.year) "" else "y"
    return at.format(formatterFor(locale, year + "MMMd" + clockSkeleton(is24Hour)))
}
