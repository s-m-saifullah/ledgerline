package app.ledgerline.android.online

import app.ledgerline.api.CreatePayment
import app.ledgerline.api.ServicePayment
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Receiving a payment for a service (ADR 0050, slice 4): one idempotent REST call with the caller's key. Clients and their
 * services are read online and never kept on the phone, so there is no mirror to update here; the screen reads them again
 * after a write, and the phone pulls so the income entry the payment made shows at once.
 */
@Singleton
class PaymentWrites @Inject constructor(private val writer: OnlineWriter) {
    suspend fun record(ledgerId: String, serviceId: String, key: String, body: CreatePayment): Written<ServicePayment> =
        writer.write { createPayment(ledgerId, serviceId, key, body) }
}
