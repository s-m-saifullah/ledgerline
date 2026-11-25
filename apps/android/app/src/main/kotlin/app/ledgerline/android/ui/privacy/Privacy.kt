package app.ledgerline.android.ui.privacy

import android.view.Window
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.res.stringResource
import app.ledgerline.android.R
import app.ledgerline.android.ui.format.formatMoney

/** True while privacy mode is on; provided once for the whole app by the activity. */
val LocalPrivacy = compositionLocalOf { false }

/** An amount as shown ([text]) and as read by a screen reader ([spoken]). */
data class ShownMoney(val text: String, val spoken: String)

/** What a mask looks like: no digit, no currency, so nothing about the amount shows. */
const val AmountMask = "•••••"

/** [amount] in minor units, or a mask with [hidden] read aloud while privacy mode is on. */
fun shownMoney(amount: Long, currency: String, private: Boolean, hidden: String): ShownMoney =
    if (private) {
        ShownMoney(AmountMask, hidden)
    } else {
        formatMoney(amount, currency).let { ShownMoney(it, it) }
    }

/** Every screen formats an amount through this, so privacy mode reaches all of them. */
@Composable
fun money(amount: Long, currency: String): ShownMoney =
    shownMoney(amount, currency, LocalPrivacy.current, stringResource(R.string.amount_hidden))

/**
 * An amount the owner has just typed, written in full even in privacy mode (SEC-7). Only a question they are about
 * to confirm uses it, so what they confirm is what they typed; every other amount goes through [money].
 */
fun typedMoney(amount: Long, currency: String): String = formatMoney(amount, currency)

/** A sentence that holds masked amounts is read with their spoken form ("Amount hidden"), not the dots. */
@Composable
fun Modifier.spokenWhenPrivate(spoken: String): Modifier =
    if (LocalPrivacy.current) semantics { contentDescription = spoken } else this

/** FLAG_SECURE keeps the app out of screenshots, screen recording and the recents preview unless allowed. */
fun Window.applyScreenshotRule(allowScreenshots: Boolean) {
    if (allowScreenshots) {
        clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    } else {
        addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
}
