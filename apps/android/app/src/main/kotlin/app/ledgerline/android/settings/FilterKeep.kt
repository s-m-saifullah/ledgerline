package app.ledgerline.android.settings

import java.time.Instant

/** The units of "keep my filters for a time I choose". */
enum class KeepUnit(val millis: Long) {
    Minutes(60_000L),
    Hours(3_600_000L),
    Days(86_400_000L),
}

/** How long the Transactions filters stay (ADR 0043, polish after the first release). */
enum class KeepMode {
    /** Cleared as soon as the owner goes to another tab. */
    UntilLeave,

    /** Kept while the app runs, cleared when it is closed or signed out. What it did before this setting. */
    UntilAppCloses,

    /** Kept for [FilterKeep.amount] [FilterKeep.unit] after the last change, also across closing the app. */
    ForAWhile,
}

/** The largest number the owner can type for a time (of minutes, hours or days). */
const val MaxKeepAmount = 999

/** The choice, with the last time typed remembered even while another mode is chosen. */
data class FilterKeep(
    val mode: KeepMode = KeepMode.UntilAppCloses,
    val amount: Int = 1,
    val unit: KeepUnit = KeepUnit.Hours,
) {
    val durationMillis: Long get() = amount * unit.millis

    /** Whether filters last changed at [changedAt] have run out of time at [now]; only a chosen time ever runs out. */
    fun expired(changedAt: Instant, now: Instant): Boolean =
        mode == KeepMode.ForAWhile && now.toEpochMilli() - changedAt.toEpochMilli() >= durationMillis

    companion object {
        /** A typed number: a whole number from 1 to [MaxKeepAmount], or null. */
        fun amountOf(text: String): Int? = text.trim().toIntOrNull()?.takeIf { it in 1..MaxKeepAmount }
    }
}
