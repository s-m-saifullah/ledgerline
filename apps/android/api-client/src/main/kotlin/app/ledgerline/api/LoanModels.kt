package app.ledgerline.api

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable

/*
 * Lending, borrowing and repaying (ADR 0050, slice 6): one idempotent write. The three actions share one path on the
 * server (`loans/{action}`) and one body; only what the money does differs.
 */

/**
 * `POST /ledgers/{ledgerId}/contacts/{contactId}/loans/lend`, `.../borrow` or `.../repay`. [amount] is in the currency of
 * the account (a `409` otherwise). The time and note are always sent, a null when empty, as the web sends them.
 */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class LoanMove(
    val accountId: String,
    val amount: Money,
    val date: String,
    @EncodeDefault val time: String? = null,
    @EncodeDefault val note: String? = null,
)

/** The person's loan in that currency as it is now, and the transfer the move made (two entries sharing [transferId]). */
@Serializable
data class LoanResult(val balance: LoanBalance, val transferId: String?, val transactionId: String?)
