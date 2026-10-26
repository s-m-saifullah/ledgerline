package app.ledgerline.android.ui.loans

import app.ledgerline.android.mirror.EntryLine
import app.ledgerline.api.LoanBalance
import app.ledgerline.api.LoanPerson
import kotlin.math.abs

/*
 * What the Loans screens decide, as plain functions of plain data (ADR 0046): which people a chip shows and in what
 * order, when the search and the chips appear, how a person stands, and which moves a person's history lists. The
 * screens only draw the answers.
 */

/** Active: people who are not archived. Archived: those who are. All: everyone. */
enum class LoanFilter { Active, Archived, All }

fun matches(person: LoanPerson, filter: LoanFilter): Boolean = when (filter) {
    LoanFilter.Active -> person.archivedAt == null
    LoanFilter.Archived -> person.archivedAt != null
    LoanFilter.All -> true
}

/** The search appears only with this many people in all, so it never comes and goes as a search or a chip narrows the list. */
const val SearchFromPeople = 8

fun showSearch(people: List<LoanPerson>): Boolean = people.size >= SearchFromPeople

/** The chips appear only while there is an archived person to reach with them. */
fun showChips(people: List<LoanPerson>): Boolean = people.any { it.archivedAt != null }

/** What is left on a loan: a positive balance is owed to the owner, a negative one is owed by them. */
private fun open(person: LoanPerson): List<LoanBalance> = person.balances.filter { it.balance.amount != 0L }

/** Whether a loan is owed to the owner (a positive balance); those amounts are drawn in the accent colour. */
fun isOwedToYou(loan: LoanBalance): Boolean = loan.balance.amount > 0

/** How a person stands, in one word: they owe you, you owe them, both (in different currencies), settled, or no loan yet. */
enum class LoanStanding { OwesYou, YouOwe, Both, Settled, None }

fun standing(person: LoanPerson): LoanStanding {
    if (person.balances.isEmpty()) return LoanStanding.None
    val open = open(person)
    if (open.isEmpty()) return LoanStanding.Settled
    val owed = open.any { it.balance.amount > 0 }
    val owe = open.any { it.balance.amount < 0 }
    return when {
        owed && owe -> LoanStanding.Both
        owed -> LoanStanding.OwesYou
        else -> LoanStanding.YouOwe
    }
}

/** The biggest amount left on any of their loans, which orders the list (currencies are not added: they cannot be without rates). */
private fun biggest(person: LoanPerson): Long = open(person).maxOfOrNull { abs(it.balance.amount) } ?: 0L

/**
 * The people [filter] shows, narrowed by [text] (a name containing it, ignoring capital letters) when the search is
 * on screen; those with the biggest loan first, settled people and people without a loan after them, then by name.
 */
fun visiblePeople(people: List<LoanPerson>, filter: LoanFilter, text: String): List<LoanPerson> {
    val words = text.trim().takeIf { showSearch(people) && it.isNotEmpty() }
    return people
        .filter { matches(it, filter) && (words == null || it.name.contains(words, ignoreCase = true)) }
        .sortedWith(compareByDescending<LoanPerson> { biggest(it) }.thenBy { it.name.lowercase() })
}

/** How many people who are not archived owe the owner something. */
fun owesYouCount(people: List<LoanPerson>): Int = people.count { it.archivedAt == null && it.balances.any { b -> b.balance.amount > 0 } }

/** How many people who are not archived the owner owes something. */
fun youOweCount(people: List<LoanPerson>): Int = people.count { it.archivedAt == null && it.balances.any { b -> b.balance.amount < 0 } }

/** How many moves a person's history lists, as the web's. */
const val MovementLimit = 8

/** The newest [limit] moves, by date, then time, then id, newest first. */
fun latestMovements(lines: List<EntryLine>, limit: Int = MovementLimit): List<EntryLine> =
    lines.sortedWith(compareByDescending<EntryLine> { it.date }.thenByDescending { it.time.orEmpty() }.thenByDescending { it.id }).take(limit)

/** Which way a move went on the loan account: positive moved money out to them, negative brought money in. */
fun isSent(line: EntryLine): Boolean = line.amount > 0

/**
 * Lent out and You owe sit side by side while the card is wide enough for both amounts (and the text is not
 * enlarged, and neither amount is long); otherwise one sits above the other, so no amount is squeezed or broken.
 */
fun summaryInColumns(contentWidthDp: Float, fontScale: Float, longestAmount: Int): Boolean =
    contentWidthDp >= 280f * maxOf(fontScale, 1f) && longestAmount <= 11
