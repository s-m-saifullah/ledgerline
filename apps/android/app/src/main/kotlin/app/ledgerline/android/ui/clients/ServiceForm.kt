package app.ledgerline.android.ui.clients

import app.ledgerline.android.ui.editor.AmountInput
import app.ledgerline.android.ui.editor.amountText
import app.ledgerline.android.ui.editor.parseAmount
import app.ledgerline.android.ui.format.formatMoney
import app.ledgerline.api.CreateService
import app.ledgerline.api.Money
import app.ledgerline.api.Service
import app.ledgerline.api.UpdateService

/** The client a service is logged for, as the phone holds it when the sheet opens. */
data class ServiceClient(val id: String, val name: String)

/** What is wrong with the form; each is said next to the field it belongs to. */
enum class ServiceProblem {
    DescriptionMissing, AmountMissing, AmountInvalid, AmountTooPrecise, AmountZero, AmountTooLarge,

    /** An edit would make the service worth less than what was already received for it (the server refuses it). */
    AmountBelowReceived,
}

/** What an edit needs to know about the service it changes: which one, at which version, and how much was received. */
data class ServiceEdit(val serviceId: String, val version: Int, val received: Long)

/** The longest description the server takes. */
const val ServiceDescriptionMax = 2_000

/**
 * The Log service form (ADR 0050, slice 5; the prototype's `OV.service`): what was done, when, when it is due, what it
 * cost and in which currency. Nothing is sent until Save. The hourly helper's two boxes ([hours], [hourlyRate]) only fill
 * the amount through [useTotal]; they are never part of the request.
 */
data class ServiceForm(
    val client: ServiceClient,
    val description: String,
    val serviceDate: String,
    /** "HH:mm", or null when no time was set. */
    val serviceTime: String? = null,
    val dueDate: String? = null,
    val currency: String,
    val amount: String = "",
    val hours: String = "",
    val hourlyRate: String = "",
    /** Set when an existing service is being edited (ADR 0050, slice 5b); null when a new one is being logged. */
    val editing: ServiceEdit? = null,
) {
    private val parsed: AmountInput get() = parseAmount(amount, currency)

    /** Once money was received the server keeps the currency the payments were recorded in. */
    val currencyLocked: Boolean get() = (editing?.received ?: 0) > 0

    /** What the helper's boxes come to in [currency], or null while one is empty. */
    val hourly: HourlyResult? get() = hourlyResult(hours, hourlyRate, currency)

    fun problems(): List<ServiceProblem> = buildList {
        if (description.isBlank()) add(ServiceProblem.DescriptionMissing)
        when (parsed) {
            AmountInput.Missing -> add(ServiceProblem.AmountMissing)
            AmountInput.Invalid -> add(ServiceProblem.AmountInvalid)
            AmountInput.TooPrecise -> add(ServiceProblem.AmountTooPrecise)
            AmountInput.Zero -> add(ServiceProblem.AmountZero)
            AmountInput.TooLarge -> add(ServiceProblem.AmountTooLarge)
            is AmountInput.Valid -> if (editing != null && (parsed as AmountInput.Valid).minor < editing.received) add(ServiceProblem.AmountBelowReceived)
        }
    }

    /** The body to send, or null while anything is wrong. A time and a due date that were not given are left out. */
    fun request(): CreateService? {
        if (problems().isNotEmpty()) return null
        val minor = (parsed as AmountInput.Valid).minor
        return CreateService(
            contactId = client.id,
            description = description.trim().take(ServiceDescriptionMax),
            serviceDate = serviceDate,
            serviceTime = serviceTime,
            dueDate = dueDate,
            amount = Money(minor, currency),
        )
    }

    /**
     * The body that saves an edit, or null while anything is wrong or no service is being edited. Every field is sent; a time or
     * due date that was cleared is a null, which the server reads as "none" (leaving a time out would keep the saved one).
     */
    fun updateRequest(): UpdateService? {
        val edit = editing ?: return null
        if (problems().isNotEmpty()) return null
        return UpdateService(
            contactId = client.id,
            description = description.trim().take(ServiceDescriptionMax),
            serviceDate = serviceDate,
            serviceTime = serviceTime,
            dueDate = dueDate,
            amount = Money((parsed as AmountInput.Valid).minor, currency),
            expectedVersion = edit.version,
        )
    }

    /**
     * Puts what the helper worked out in the amount (in the currency's decimals) and, when the description is blank, how it
     * was worked out ("3.5 h at $40.00/h", with the rate shown by [rateLabel]). Does nothing while the boxes do not give a total.
     * With [describe] false (amounts are hidden) the description is left alone: the words hold the rate, and they are saved.
     */
    fun useTotal(rateLabel: (Long, String) -> String = ::formatMoney, describe: Boolean = true): ServiceForm {
        val result = hourly as? HourlyResult.Total ?: return this
        return copy(
            amount = amountText(result.total, currency),
            description = if (describe && description.isBlank()) "${result.hours} h at ${rateLabel(result.rate, currency)}/h" else description,
        )
    }

    companion object {
        /** An existing [service] of [client], as the phone holds it when the sheet opens. */
        fun forEditing(client: ServiceClient, service: Service) = ServiceForm(
            client = client,
            description = service.description,
            serviceDate = service.serviceDate,
            serviceTime = service.serviceTime,
            dueDate = service.dueDate,
            currency = service.amount.currency,
            amount = amountText(service.amount.amount, service.amount.currency),
            editing = ServiceEdit(service.id, service.version, service.received.amount),
        )

        fun forClient(client: ServiceClient, today: String) = ServiceForm(client, description = "", serviceDate = today, currency = BaseCurrency)
    }
}
