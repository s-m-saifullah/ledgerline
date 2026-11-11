package app.ledgerline.android.ui.loans

import app.ledgerline.android.ui.clients.BaseCurrency
import app.ledgerline.android.ui.editor.AmountInput
import app.ledgerline.android.ui.editor.parseAmount
import app.ledgerline.api.LoanMove
import app.ledgerline.api.Money
import kotlin.math.abs

/** What the sheet does with the money: [Lend] and [Borrow] open a loan or add to it, [Repay] settles some of what is open. */
enum class LoanKind { Lend, Borrow, Repay }

/** The person the money moves to or from, as the phone holds them when the sheet opens. */
data class LoanWho(val id: String, val name: String)

/** One of the owner's own open accounts (an account kept for a client or a person is not one). */
data class LoanAccount(val id: String, val name: String, val currency: String)

/** What is open with the person in one currency: positive when they owe you, negative when you owe them. */
data class OpenLoan(val currency: String, val balance: Long)

/** What is wrong with the form; each is said next to the field it belongs to. */
enum class LoanProblem { AmountMissing, AmountInvalid, AmountTooPrecise, AmountZero, AmountTooLarge, AccountMissing, MoreThanOpen }

/** The longest note the server takes. */
const val LoanNoteMax = 2_000

/**
 * The Lend, Borrow and Repay form (ADR 0050, slice 6; the web's `LoanDialog`): an amount, the account the money goes
 * through, a date and a note. The amount starts empty, also for a repayment. For a lend or a borrow the account decides the
 * currency; a repayment is in the currency of the loan being settled ([currency], the one chosen if it is open, else the
 * first), and only accounts in it are offered. With no account chosen the first one offered is used, as on the web.
 */
data class LoanForm(
    val who: LoanWho,
    val kind: LoanKind,
    /** The loans with something left, in the order the server lists them. */
    val open: List<OpenLoan>,
    val accounts: List<LoanAccount>,
    val date: String,
    val accountId: String? = null,
    /** The currency chosen for a repayment; used only while a loan in it is open. */
    val chosenCurrency: String? = null,
    val amount: String = "",
    val note: String = "",
) {
    /** The currency of the loan a repayment settles; null for a lend or a borrow. */
    val currency: String? get() = if (kind == LoanKind.Repay) chosenCurrency?.takeIf { c -> open.any { it.currency == c } } ?: open.firstOrNull()?.currency else null

    /** The currencies a repayment can choose from; the row shows only when there is more than one. */
    val currencyChoices: List<String> get() = if (kind == LoanKind.Repay && open.size > 1) open.map { it.currency } else emptyList()

    /** What is left in [currency], signed: positive when they owe you. */
    val balance: Long get() = open.firstOrNull { it.currency == currency }?.balance ?: 0

    val owedToYou: Boolean get() = balance > 0

    /** The accounts to choose from: any for a lend or a borrow, those in the loan's currency for a repayment. */
    val usable: List<LoanAccount> get() = if (kind == LoanKind.Repay) accounts.filter { it.currency == currency } else accounts

    /** The account the money goes through: the chosen one while it is offered, else the first offered. */
    val account: LoanAccount? get() = usable.firstOrNull { it.id == accountId } ?: usable.firstOrNull()

    /** Money comes into the account when borrowing and when they pay you back; it goes out when lending and when you pay them back. */
    val accountReceives: Boolean get() = when (kind) {
        LoanKind.Lend -> false
        LoanKind.Borrow -> true
        LoanKind.Repay -> owedToYou
    }

    /** The currency the amount is in: the loan's for a repayment, else the account's (the base currency until there is one). */
    val amountCurrency: String get() = currency ?: account?.currency ?: BaseCurrency

    private val parsed: AmountInput get() = parseAmount(amount, amountCurrency)

    /** A repayment in another currency starts over with the account (the one chosen may not be in it); what was typed stays. */
    fun withCurrency(code: String) = copy(chosenCurrency = code, accountId = null)

    fun problems(): List<LoanProblem> = buildList {
        when (val input = parsed) {
            AmountInput.Missing -> add(LoanProblem.AmountMissing)
            AmountInput.Invalid -> add(LoanProblem.AmountInvalid)
            AmountInput.TooPrecise -> add(LoanProblem.AmountTooPrecise)
            AmountInput.Zero -> add(LoanProblem.AmountZero)
            AmountInput.TooLarge -> add(LoanProblem.AmountTooLarge)
            is AmountInput.Valid -> if (kind == LoanKind.Repay && input.minor > abs(balance)) add(LoanProblem.MoreThanOpen)
        }
        if (account == null) add(LoanProblem.AccountMissing)
    }

    /** The body to send, or null while anything is wrong. */
    fun request(): LoanMove? {
        if (problems().isNotEmpty()) return null
        val minor = (parsed as AmountInput.Valid).minor
        return LoanMove(
            accountId = account!!.id,
            amount = Money(minor, amountCurrency),
            date = date,
            time = null,
            note = note.trim().take(LoanNoteMax).ifEmpty { null },
        )
    }

    companion object {
        fun start(who: LoanWho, kind: LoanKind, open: List<OpenLoan>, accounts: List<LoanAccount>, today: String) =
            LoanForm(who, kind, open, accounts, today)
    }
}
