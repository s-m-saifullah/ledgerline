package app.ledgerline.android.settings

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** What the last payment and the last loan move chose is kept for the next start, as ids only, and forgotten on sign-out. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PaymentChoicesStoreTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun nothingIsChosenAtFirst() {
        assertEquals(PaymentChoices(), PrefsPaymentChoicesStore(context).load())
    }

    @Test
    fun theChoicesIncludingTheLoanAccountAreKeptForTheNextStart() {
        PrefsPaymentChoicesStore(context).save(PaymentChoices("a1", "c1", "c2", loanAccountId = "a2"))
        assertEquals(PaymentChoices("a1", "c1", "c2", "a2"), PrefsPaymentChoicesStore(context).load())
    }

    @Test
    fun clearingForgetsEveryChoice() {
        val store = PrefsPaymentChoicesStore(context)
        store.save(PaymentChoices("a1", "c1", "c2", "a2"))
        store.clear()
        assertEquals(PaymentChoices(), PrefsPaymentChoicesStore(context).load())
    }
}
