package app.ledgerline.android.ui.clients

import app.ledgerline.api.Contact
import app.ledgerline.api.EntrySplit
import app.ledgerline.api.HistoryEvent
import app.ledgerline.api.HistoryPayment
import app.ledgerline.api.HistoryService
import app.ledgerline.api.HistorySnapshot
import app.ledgerline.api.LoanBalance
import app.ledgerline.api.LoanPerson
import app.ledgerline.api.Money
import app.ledgerline.api.PaymentEntry
import app.ledgerline.api.PaymentTip
import app.ledgerline.api.Service
import app.ledgerline.api.ServicePayment

private fun usd(amount: Long) = Money(amount, "USD")

private const val Stamp = "2026-10-23T09:09:00.000Z"

/** A client who owes [owed] (no open service when 0). */
internal fun contact(
    name: String,
    owed: Long = 0,
    id: String = name.lowercase().replace(' ', '-'),
    oldest: String? = null,
    archived: Boolean = false,
    origin: String = "client",
    phone: String? = null,
    email: String? = null,
    note: String? = null,
    balances: List<Money>? = null,
    unconverted: List<String> = emptyList(),
) = Contact(
    name = name,
    phone = phone,
    email = email,
    note = note,
    createdAt = Stamp,
    updatedAt = Stamp,
    origin = origin,
    id = id,
    ledgerId = "ledger-a",
    version = 1,
    archivedAt = if (archived) Stamp else null,
    openBalance = usd(owed),
    openBalances = balances ?: if (owed > 0) listOf(usd(owed)) else emptyList(),
    unconvertedCurrencies = unconverted,
    oldestOpenServiceDate = oldest,
)

/** A service of [cents] with [received] paid; its status and what is outstanding follow from them. */
internal fun service(
    description: String,
    cents: Long,
    received: Long = 0,
    date: String = "2026-10-02",
    time: String? = null,
    due: String? = null,
    id: String = description.lowercase().replace(' ', '-'),
    writtenOff: Long = 0,
    reason: String? = null,
): Service {
    val outstanding = if (writtenOff > 0) 0 else cents - received
    return Service(
        contactId = "northwind-design",
        description = description,
        serviceDate = date,
        serviceTime = time,
        dueDate = due,
        amount = usd(cents),
        createdAt = Stamp,
        updatedAt = Stamp,
        id = id,
        ledgerId = "ledger-a",
        version = 1,
        received = usd(received),
        remaining = usd(cents - received),
        outstanding = usd(outstanding),
        status = when {
            writtenOff > 0 -> "writtenOff"
            received == 0L -> "unpaid"
            received < cents -> "partlyPaid"
            else -> "paid"
        },
        writtenOffAt = if (writtenOff > 0) Stamp else null,
        writtenOffAmount = if (writtenOff > 0) usd(writtenOff) else null,
        writeOffReason = reason,
    )
}

/** A payment of [cents] received for [service], with an optional tip and note. */
internal fun payment(service: Service, cents: Long, date: String = "2026-10-05", time: String? = null, tip: Long? = null, note: String? = null) = ServicePayment(
    id = "pay-${service.id}-$cents",
    ledgerId = "ledger-a",
    receivableId = service.id,
    transactionId = "tx-$cents",
    amount = usd(cents),
    receiptId = null,
    version = 1,
    createdAt = Stamp,
    updatedAt = Stamp,
    tip = tip?.let { PaymentTip("tx-tip", usd(it), "c-income", null) },
    transaction = PaymentEntry(
        accountId = "a1", categoryId = "c-income", kind = "income", date = date, time = time, amount = usd(cents), status = "cleared",
        payee = null, note = note, id = "tx-$cents", ledgerId = "ledger-a", fxRate = "1", baseAmount = usd(cents), transferId = null,
        relatedTransferId = null, feeTransferId = null, tipPaymentId = null, receivablePaymentId = null, receivableId = service.id,
        isSplit = false, splits = emptyList<EntrySplit>(), tags = emptyList(), version = 1, createdAt = Stamp, updatedAt = Stamp,
    ),
    receivable = service,
)

private fun historyService(service: Service) = HistoryService(
    service.contactId, service.description, service.serviceDate, service.serviceTime, service.dueDate, service.amount, service.createdAt,
    service.updatedAt, service.id, service.ledgerId, service.version, service.received, service.remaining, service.outstanding, service.status,
    service.writtenOffAt, service.writtenOffAmount, service.writeOffReason, deletedAt = null,
)

private fun historyPayment(payment: ServicePayment) = payment.transaction.let {
    HistoryPayment(
        it.accountId, it.categoryId, it.kind, it.date, it.time, it.amount, it.status, it.payee, it.note, it.id, it.ledgerId, it.fxRate, it.baseAmount,
        it.transferId, it.relatedTransferId, it.feeTransferId, it.tipPaymentId, it.receivablePaymentId, it.receivableId, it.isSplit, it.splits, it.tags,
        it.version, it.createdAt, it.updatedAt, deletedAt = null,
    )
}

/** One history event: [action] happened to [service], optionally with a [payment] (and the payment it replaced in [before]). */
internal fun event(
    action: String,
    service: Service,
    payment: ServicePayment? = null,
    before: ServicePayment? = null,
    id: String = "$action-${service.id}-${payment?.amount?.amount}",
    createdAt: String = Stamp,
) = HistoryEvent(
    id = id,
    ledgerId = "ledger-a",
    contactId = service.contactId,
    receivableId = service.id,
    paymentId = payment?.id,
    transactionId = payment?.transactionId,
    actorId = "owner",
    action = action,
    receivableVersion = service.version,
    before = before?.let { HistorySnapshot(historyService(service), historyPayment(it), null) },
    after = HistorySnapshot(historyService(service), payment?.let(::historyPayment), payment?.tip),
    createdAt = createdAt,
    updatedAt = createdAt,
)

/** A person for loans with a balance per currency (positive: they owe you). */
internal fun person(name: String, vararg balances: Pair<String, Long>, archived: Boolean = false, id: String = name.lowercase().replace(' ', '-')) = LoanPerson(
    id = id,
    name = name,
    origin = "loan",
    archivedAt = if (archived) Stamp else null,
    version = 1,
    balances = balances.map { loan(it.first, it.second) },
)

/** A loan in [currency] standing at [balance], with [opening] from before Ledgerline. */
internal fun loan(currency: String, balance: Long, opening: Long = 0) = LoanBalance(
    accountId = "loan-$currency",
    currency = currency,
    openingBalance = Money(opening, currency),
    balance = Money(balance, currency),
    version = 1,
)

/** What is lent out and owed in total, as Home reports it. */
internal fun homeLoans(lent: Long, borrowed: Long) = app.ledgerline.api.HomeLoans(Money(lent, "USD"), Money(borrowed, "USD"))
