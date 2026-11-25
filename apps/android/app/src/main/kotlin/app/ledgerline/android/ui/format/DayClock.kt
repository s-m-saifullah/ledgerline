package app.ledgerline.android.ui.format

import android.text.format.DateFormat
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.platform.LocalContext
import java.time.LocalDate

/**
 * What a date or time on a row needs from the phone: the day it is today (a day this year is written without its year) and
 * its 24-hour setting. A screen reads it once with [dayClock]; a test provides its own through [LocalDayClock], so what a
 * hint says does not depend on the day the tests run.
 */
class DayClock(val today: LocalDate, val is24Hour: Boolean)

val LocalDayClock = compositionLocalOf<DayClock?> { null }

@Composable
fun dayClock(): DayClock = LocalDayClock.current ?: DayClock(LocalDate.now(), DateFormat.is24HourFormat(LocalContext.current))
