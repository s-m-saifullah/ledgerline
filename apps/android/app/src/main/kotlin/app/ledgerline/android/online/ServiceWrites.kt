package app.ledgerline.android.online

import app.ledgerline.api.CreateService
import app.ledgerline.api.ExpectedVersion
import app.ledgerline.api.Service
import app.ledgerline.api.UpdateService
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Logging, editing and deleting a service for a client (ADR 0050, slices 5 and 5b): one idempotent REST call each with the caller's key. Clients and their
 * services are read online and never kept on the phone, and no money moves until a payment, so there is nothing in the
 * mirror to update; the screen reads the client again after a write.
 */
@Singleton
class ServiceWrites @Inject constructor(private val writer: OnlineWriter) {
    suspend fun log(ledgerId: String, key: String, body: CreateService): Written<Service> =
        writer.write { createService(ledgerId, key, body) }

    suspend fun update(ledgerId: String, serviceId: String, key: String, body: UpdateService): Written<Service> =
        writer.write { updateService(ledgerId, serviceId, key, body) }

    /** Deletes the service at [version]; the server refuses while it has live payments. */
    suspend fun delete(ledgerId: String, serviceId: String, key: String, version: Int): Written<Unit> =
        writer.write { deleteService(ledgerId, serviceId, key, ExpectedVersion(version)) }
}
