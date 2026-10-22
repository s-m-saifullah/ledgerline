package app.ledgerline.android.sync

import android.content.Context
import androidx.core.content.edit
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/** Which ledger the phone mirrors. Today it is the first ledger the server lists; a picker can set it later. */
interface LedgerChoice {
    fun get(): String?

    fun set(ledgerId: String)

    fun clear()
}

@Singleton
class PrefsLedgerChoice @Inject constructor(@ApplicationContext context: Context) : LedgerChoice {
    private val prefs = context.getSharedPreferences("mirror", Context.MODE_PRIVATE)

    override fun get(): String? = prefs.getString("ledgerId", null)

    override fun set(ledgerId: String) = prefs.edit(commit = true) { putString("ledgerId", ledgerId) }

    override fun clear() = prefs.edit(commit = true) { remove("ledgerId") }
}
