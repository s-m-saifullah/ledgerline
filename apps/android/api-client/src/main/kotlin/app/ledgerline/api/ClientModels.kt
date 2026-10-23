package app.ledgerline.api

import kotlinx.serialization.Serializable

/*
 * Clients and Loans (slice 5): read online, never stored on the phone. The contract always sends every property
 * (absent values as null), so none has a default; text enums stay strings so a value a newer
 * server adds cannot break a screen.
 */

/** A page of clients (or of people, for loans); [nextCursor] is sent back as `cursor` for the next page. */
@Serializable
data class ContactList(val items: List<Contact>, val nextCursor: String?)

/** A client, or a person you lend to or borrow from ([origin]); [openBalances] are their unpaid services per currency. */
@Serializable
data class Contact(
    val name: String,
    val phone: String?,
    val email: String?,
    val note: String?,
    val createdAt: String,
    val updatedAt: String,
    val origin: String,
    val id: String,
    val ledgerId: String,
    val version: Int,
    val archivedAt: String?,
    val openBalance: Money,
    val openBalances: List<Money>,
    val unconvertedCurrencies: List<String>,
    val oldestOpenServiceDate: String?,
)

@Serializable
data class ServiceList(val items: List<Service>, val nextCursor: String?)

/** A service logged for a client: what it was, what it cost, what was received and what is left. */
@Serializable
data class Service(
    val contactId: String,
    val description: String,
    val serviceDate: String,
    val serviceTime: String?,
    val dueDate: String?,
    val amount: Money,
    val createdAt: String,
    val updatedAt: String,
    val id: String,
    val ledgerId: String,
    val version: Int,
    val received: Money,
    val remaining: Money,
    val outstanding: Money,
    val status: String,
    val writtenOffAt: String?,
    val writtenOffAmount: Money?,
    val writeOffReason: String?,
)

@Serializable
data class PaymentList(val items: List<ServicePayment>, val nextCursor: String?)

/** A payment received for a service, with the income entry it created and its optional tip. */
@Serializable
data class ServicePayment(
    val id: String,
    val ledgerId: String,
    val receivableId: String,
    val transactionId: String,
    val amount: Money,
    val receiptId: String?,
    val version: Int,
    val createdAt: String,
    val updatedAt: String,
    val tip: PaymentTip?,
    val transaction: PaymentEntry,
    val receivable: Service,
)

@Serializable
data class PaymentTip(val transactionId: String, val amount: Money, val categoryId: String, val deletedAt: String?)

/** The entry a payment created, as the payments list returns it. */
@Serializable
data class PaymentEntry(
    val accountId: String,
    val categoryId: String?,
    val kind: String,
    val date: String,
    val time: String?,
    val amount: Money,
    val status: String,
    val payee: String?,
    val note: String?,
    val id: String,
    val ledgerId: String,
    val fxRate: String,
    val baseAmount: Money,
    val transferId: String?,
    val relatedTransferId: String?,
    val feeTransferId: String?,
    val tipPaymentId: String?,
    val receivablePaymentId: String?,
    val receivableId: String?,
    val isSplit: Boolean,
    val splits: List<EntrySplit>,
    val tags: List<TagRef>,
    val version: Int,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class EntrySplit(
    val id: String,
    val categoryId: String,
    val amount: Money,
    val note: String?,
    val version: Int,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class HistoryList(val items: List<HistoryEvent>, val nextCursor: String?)

/** One thing that happened to a client's services, with the service (and payment and tip) before and after. */
@Serializable
data class HistoryEvent(
    val id: String,
    val ledgerId: String,
    val contactId: String,
    val receivableId: String,
    val paymentId: String?,
    val transactionId: String?,
    val actorId: String,
    val action: String,
    val receivableVersion: Int,
    val before: HistorySnapshot?,
    val after: HistorySnapshot,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class HistorySnapshot(val service: HistoryService, val payment: HistoryPayment?, val tip: PaymentTip?)

/** A service as history kept it: like [Service], and when it was deleted. */
@Serializable
data class HistoryService(
    val contactId: String,
    val description: String,
    val serviceDate: String,
    val serviceTime: String?,
    val dueDate: String?,
    val amount: Money,
    val createdAt: String,
    val updatedAt: String,
    val id: String,
    val ledgerId: String,
    val version: Int,
    val received: Money,
    val remaining: Money,
    val outstanding: Money,
    val status: String,
    val writtenOffAt: String?,
    val writtenOffAmount: Money?,
    val writeOffReason: String?,
    val deletedAt: String?,
)

/** A payment's entry as history kept it: like [PaymentEntry], and when it was deleted. */
@Serializable
data class HistoryPayment(
    val accountId: String,
    val categoryId: String?,
    val kind: String,
    val date: String,
    val time: String?,
    val amount: Money,
    val status: String,
    val payee: String?,
    val note: String?,
    val id: String,
    val ledgerId: String,
    val fxRate: String,
    val baseAmount: Money,
    val transferId: String?,
    val relatedTransferId: String?,
    val feeTransferId: String?,
    val tipPaymentId: String?,
    val receivablePaymentId: String?,
    val receivableId: String?,
    val isSplit: Boolean,
    val splits: List<EntrySplit>,
    val tags: List<TagRef>,
    val version: Int,
    val createdAt: String,
    val updatedAt: String,
    val deletedAt: String?,
)

@Serializable
data class LoanPersonList(val items: List<LoanPerson>, val nextCursor: String?)

/** A person you lend to or borrow from, with a balance per currency. */
@Serializable
data class LoanPerson(
    val id: String,
    val name: String,
    val origin: String,
    val archivedAt: String?,
    val version: Int,
    val balances: List<LoanBalance>,
)

/** One person's loan in one currency; a positive [balance] means they owe you. */
@Serializable
data class LoanBalance(
    val accountId: String,
    val currency: String,
    val openingBalance: Money,
    val balance: Money,
    val version: Int,
)

@Serializable
data class LoanList(val items: List<LoanBalance>)
