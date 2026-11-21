package app.ledgerline.android.ui.design

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext

/**
 * Runs [onLeave] when the screen goes away for good: a tab change, Back, another screen. A rotation, a dark-mode switch or a
 * font-size change recreates the activity and disposes the screen too, but the person is still on it, so nothing is closed:
 * an open sheet keeps what was typed and the keys that make a retry safe (AND-P4).
 */
@Composable
fun OnLeaving(onLeave: () -> Unit) {
    val latest by rememberUpdatedState(onLeave)
    val activity = LocalContext.current.activity()
    DisposableEffect(Unit) {
        onDispose { if (activity?.isChangingConfigurations != true) latest() }
    }
}

private fun Context.activity(): Activity? {
    var context = this
    while (context is ContextWrapper) {
        if (context is Activity) return context
        context = context.baseContext
    }
    return null
}
