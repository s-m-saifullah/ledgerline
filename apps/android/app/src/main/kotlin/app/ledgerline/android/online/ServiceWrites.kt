package app.ledgerline.android.online

import app.ledgerline.api.CreateService
import app.ledgerline.api.Service
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Logging a service for a client (ADR 0050, slice 5): one idempotent REST call with the caller's key. Clients and their
 * services are read online and never kept on the phone, and no money moves until a payment, so there is nothing in the
 * mirror to update; the screen reads the client again after a write.
 */
@Singleton
class ServiceWrites @Inject constructor(private val writer: OnlineWriter) {
    suspend fun log(ledgerId: String, key: String, body: CreateService): Written<Service> =
        writer.write { createService(ledgerId, key, body) }
}
