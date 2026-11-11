package app.ledgerline.android.online

import app.ledgerline.api.CreateReceipt
import app.ledgerline.api.Receipt
import app.ledgerline.api.ReceiptPreview
import javax.inject.Inject
import javax.inject.Singleton

/**
 * A payment from a client (ADR 0050, slice 4c): the preview of which services an amount would pay (a read, nothing is
 * changed) and the one idempotent write with the caller's key. Clients and their services are read online and never kept
 * on the phone, so there is no mirror to update; the screen reads them again after a write, and the phone pulls so the
 * income entries show at once.
 */
@Singleton
class ReceiptWrites @Inject constructor(private val writer: OnlineWriter, private val reader: OnlineReader) {
    suspend fun preview(ledgerId: String, contactId: String, amount: Long, currency: String): Online<ReceiptPreview> =
        reader.read { receiptPreview(ledgerId, contactId, amount, currency) }

    suspend fun record(ledgerId: String, contactId: String, key: String, body: CreateReceipt): Written<Receipt> =
        writer.write { createReceipt(ledgerId, contactId, key, body) }
}
