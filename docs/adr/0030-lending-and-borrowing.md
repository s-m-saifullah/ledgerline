# ADR 0030: Lending and borrowing with clients

Date: 2026-10-17. Status: accepted by the owner when approving the design in chat (one running balance per client and currency, forgiveness both ways, existing loans can be added without moving money).

## Context

Clients track services and payments, and every payment is income. A loan is not income or spending, so it cannot use that path. Transfers already behave correctly for loans (they stay out of income, spending and budgets, and balances are computed), but both ends must be accounts, and the other person is not an account.

## Decisions

- **A balance account per client and currency.** An account of the existing `loan` type that is linked to a client (`accounts.contact_id`, scoped); a `loan` account with no client is an ordinary debt you owe, as before. One per client and currency, created on first use. Its balance is the usual computed one (opening balance plus entries). Positive means the client owes you; negative means you owe the client. It counts toward net worth and never toward In hand. No new account type is needed.
- **Moves are ordinary transfers.** Lend: your account to the client balance. Borrow: the client balance to your account. Repay: the direction follows the balance's sign and the amount cannot exceed what is open. They are plain transfers afterwards (editable, deletable, Undo); the balance is always recomputed, so nothing can drift. Both accounts must use the loan's currency in this first version.
- **Forgive** the open balance: an ordinary expense (you forgive them) or income (they forgive you) entry on the client balance account, in a category the owner chooses. It needs no link; it is a normal entry.
- **Existing loans.** "Add an existing loan" sets the client's balance account's opening balance, so no money moves in any of your own accounts. It can be changed later with an expected version. It is shown on the client card as "Before Ledgerline".
- **Managed accounts.** Accounts linked to a client cannot be created, renamed, archived or deleted from the accounts API (409 with a pointer to Clients) and are not offered in account pickers. A client that has a balance account cannot be deleted.
- **Home.** Net worth already sums every account. Home gains `owed.lent` and `owed.borrowed` (valued like money owed, with missing-rate notices), and client-linked accounts stay out of `liabilitiesOwed` so a borrowed amount is not counted twice.
- **Out of scope for now.** Interest, due dates and reminders, separate loans with their own history, and loans across currencies.
- **API.** Additive: `GET /contacts/{id}/loans`, `POST /contacts/{id}/loans/{lend|borrow|repay|forgive|opening}`. Idempotency-Key, camelCase, money as `{ amount, currency }`, ledger-scoped with cross-ledger tests. Backup manifest and restore drill check that every client balance account has its client, one per client and currency.
