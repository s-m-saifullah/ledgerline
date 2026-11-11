package app.ledgerline.android.settings

import android.content.Context
import androidx.core.content.edit
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Inject
import javax.inject.Singleton

/**
 * What the last payment chose, so the next one starts there (ADR 0050), as the web keeps them in its browser storage:
 * the receiving account, the income category and the tip's category, and the account of the last loan move. Ids only, never an amount or a name; one that is
 * no longer offered is ignored when the sheet opens.
 */
data class PaymentChoices(
    val accountId: String? = null,
    val categoryId: String? = null,
    val tipCategoryId: String? = null,
    /** The account the last lend, borrow or repayment went through (ADR 0050, slice 6); kept apart from the payments' account. */
    val loanAccountId: String? = null,
)

/** Where those choices wait. The phone's private storage like the filters: the app allows no backups, and signing out deletes it. */
interface PaymentChoicesStore {
    fun load(): PaymentChoices

    fun save(choices: PaymentChoices)

    fun clear()
}

@Singleton
class PrefsPaymentChoicesStore @Inject constructor(@ApplicationContext context: Context) : PaymentChoicesStore {
    private val prefs = context.getSharedPreferences("payment-choices", Context.MODE_PRIVATE)

    override fun load() = PaymentChoices(
        accountId = prefs.getString("accountId", null),
        categoryId = prefs.getString("categoryId", null),
        tipCategoryId = prefs.getString("tipCategoryId", null),
        loanAccountId = prefs.getString("loanAccountId", null),
    )

    override fun save(choices: PaymentChoices) = prefs.edit(commit = true) {
        putString("accountId", choices.accountId)
        putString("categoryId", choices.categoryId)
        putString("tipCategoryId", choices.tipCategoryId)
        putString("loanAccountId", choices.loanAccountId)
    }

    override fun clear() = prefs.edit(commit = true) { clear() }
}

@Module
@InstallIn(SingletonComponent::class)
abstract class PaymentChoicesStoreModule {
    @Binds
    abstract fun bindPaymentChoicesStore(store: PrefsPaymentChoicesStore): PaymentChoicesStore
}
