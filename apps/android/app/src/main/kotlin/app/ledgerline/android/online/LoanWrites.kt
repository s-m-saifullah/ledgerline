package app.ledgerline.android.online

import app.ledgerline.api.LoanMove
import app.ledgerline.api.LoanResult
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Lending, borrowing and repaying (ADR 0050, slice 6): one idempotent REST call each with the caller's key. A person's loans
 * are read online and never kept on the phone, so there is nothing in the mirror to update here; the screen reads them again
 * after a write, and the phone pulls so the transfer shows in the accounts and in the person's moves at once.
 */
@Singleton
class LoanWrites @Inject constructor(private val writer: OnlineWriter) {
    suspend fun lend(ledgerId: String, personId: String, key: String, body: LoanMove): Written<LoanResult> =
        writer.write { lendLoan(ledgerId, personId, key, body) }

    suspend fun borrow(ledgerId: String, personId: String, key: String, body: LoanMove): Written<LoanResult> =
        writer.write { borrowLoan(ledgerId, personId, key, body) }

    suspend fun repay(ledgerId: String, personId: String, key: String, body: LoanMove): Written<LoanResult> =
        writer.write { repayLoan(ledgerId, personId, key, body) }
}
