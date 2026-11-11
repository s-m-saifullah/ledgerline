# ADR 0050: Money writes on the phone (Android)

Date: 2026-11-09. Status: accepted by the owner in chat on 2026-11-09 (scope, payments in other currencies, marking a service paid, the keypad, the sign-in message). Amends [0043](0043-android-app.md), which left adding loans and logging services on the web, and carries out the follow-ups listed in [0046](0046-clutter-free-redesign.md). Builds on [0042](0042-sync-and-bearer-tokens.md) (idempotent writes) and [0048](0048-profile-and-managed-users.md) (the temporary password).

## Context

The phone reads Clients and Loans but cannot change them: its screens say "stays on the web". The web can receive a payment, log a service, lend more and record a repayment, and the server routes for all of them already exist. Setting and removing a budget limit already works on the phone (#186). **Production has a real user. Nothing existing may change.**

## Decisions

- **In scope, on the phone:** receive a payment, receive a payment from a client (a receipt, see the amendment), mark a service paid, log a service, lend more and record a repayment. Budget limits are done.
- **Still web only:** adding, renaming and archiving a client or person; reorder, merge, the starter set and icon and colour for categories; tags created on the phone; Profile and Change password; Users and Recently deleted (ADRs 0048 and 0049 stand); Clear ledger and its undo; editing and deleting a receipt (recording one is on the phone, see the amendment); send reminder; Auto-Set Limits.
- **Online writes, no outbox.** Each write is one idempotent REST call with an `Idempotency-Key` that is made once per change and sent again on a retry, as category and budget writes already do. Nothing is queued: a payment needs the server's balances and rates. Offline, the sheet says so and keeps what was typed. A `409` version conflict reloads the screen and says so.
- **The web's rules, not new ones.** A payment in another currency follows the web: the amount received, the rate, a tip, and manual rates are never overwritten. The sheet asks a question before it sends (a confirmation, not one tap), as ADR 0046 says. The phone computes nothing the server will not check again.
- **Mark paid is the receive-payment sheet** with the outstanding amount filled in, opened by one tap on an unpaid service. There is one write path.
- **The in-app keypad is not built.** The editor keeps the system keyboard and cents-first typing (ADR 0046); ADR 0047's "not decided" becomes "not built".
- **A person on a temporary password who signs in on the phone** is told why nothing loads. Sign-in succeeds (the sign-in routes are open), then every data route answers `403`, and the phone showed only "Could not update". After sign-in the app reads `GET /api/v1/me`, which that person may call; when `mustChangePassword` is true it says "Choose a new password on the web, then sign in here again." and signs out. Changing the password stays on the web.
- **The design rules of ADR 0046 apply:** screens from `ui/design`, the 10 sp text floor, 4.5:1 contrast, 48 dp targets, the single teal accent, one short hint per row.

## API

No server change is planned: `POST /receivables/{id}/payments`, `GET /contacts/{id}/receipt-preview`, `POST /contacts/{id}/receipts`, `POST /receivables`, `POST /contacts/{id}/loans/lend` and `.../repay`, and `GET /me` exist. The phone's hand-written types gain each route's request and reply, each with a case in the contract test against `openapi.json`.

## Keeping production safe

- The writes change real money rows, so they are tried only against a scratch server (never his dev servers or production) and compared with the web's balances.
- Each slice is its own pull request with tests that fail first, a deliberate-mutation check on each new rule and screenshots at 320 and 390 dp, light and dark, and with the largest text; sheets are checked on his phone before the next slice.
- Android releases are his to tag. The next one also carries AGP 9.5.0, Roborazzi 1.77.0 and `clearedAt`.

## Slices

1. This ADR and the PROGRESS correction (documentation only).
2. The sign-in message for a temporary password.
3. The shared online-write helper and the money sheet.
4. Receive payment, with a tip; mark paid. Split in three pull requests: 4a one service in its own currency (built), 4c a payment from a client (below), then other currencies for both, in two pull requests: 4b-1 where one side is USD (the amount received, the rate the two amounts fix and a tip in the account's currency) and 4b-2 where neither side is USD (the stored rate looked up, or one set by hand).
5. Log service.
6. Lend more and Repay.

## Amendment, 2026-11-10: a payment from a client (slice 4c)

Accepted by the owner in chat on 2026-11-10. The first version of this ADR listed receipts as web only. The owner asked for the web's **Record payment from client** on the phone: one amount applied to the client's oldest unpaid services first.

- **Recording a receipt is on the phone; editing and deleting one stay on the web.** The client's balance card has a filled **Record payment** button while they owe (the screen's one primary action; each service keeps its outlined button). The sheet has the amount with **Pay full balance**, a live "Pays, oldest first" preview, a currency row only when the client owes in several currencies, the same Account, Category and tip rows as slice 4a, and a question before it sends.
- **One idempotent write**, `POST /contacts/{id}/receipts`, with `expectedAllocations` copied from the preview that matches the amount shown; a service that changed meanwhile is a `409`, which reads the client again and says so. An amount over the open total settles everything and the rest is one tip, as the web does.
- **Order:** 4c is built before 4b (other currencies), so the rate lookup and the amount received are built once for both flows.

## Amendment, 2026-11-11: neither side USD (slice 4b-2)

Built as planned; two details the first plan did not fix. **Saving waits for a rate:** when the ledger holds no rate for the account's currency on the payment's date and none is typed, the phone does not send (the server would answer `409`); a look-up that failed does not block, because the server decides. A rate typed that cannot be stored also blocks, where the web silently uses the stored one. **The rate is for the account's currency** on the payment's date, valued against USD; it only prices the income entry, so the settled and received amounts do not change. The phone sends `fxRate` only when it was typed, never for a pair with USD in it. A rate typed by hand may start with the point (".8") or end with it ("8."); the web's function refuses both, the phone does not.

## Amendment, 2026-11-11: log a service (slice 5)

Built as planned; no server change. **Log service** is on the client's screen: an outlined button on the balance card beside the filled **Record payment** (also for a client who owes nothing, and never for an archived one, as on the web), and the same action in the "No services yet" state. The prototype shows its button on the desktop only, because the web's phone has an Add button; the Android Clients screen has none, so the phone shows it. The sheet asks for what was done, when (date and an optional time), an optional due date, the currency (only when the ledger has more than one) and the amount, with the web's "Paid by the hour?" helper folded away; the helper only fills the amount and its maths is checked against the web's own functions. **Nothing is asked before it sends**, because no money moves; it is one idempotent write, `POST /receivables`, with a key per change, so a retry after a lost answer creates one service. Editing, deleting, writing off, reopening and moving a service stay web only. After the phone check the owner asked for editing and deleting a service on the phone too; that is a separate slice, 5b, and is planned before it is built.

## Amendment, 2026-11-11: edit and delete a service (slice 5b)

Accepted by the owner in chat on 2026-11-11, after the phone check of slice 5. An opened service on the client's screen has **Edit service** and **Delete service**. Editing reuses the Log service sheet, filled in, with one `PATCH /receivables/{id}` carrying the service's version. The currency is locked once money was received, and an amount below what was received is refused on the phone before it is sent. A cleared time or due date is sent as an explicit null. A written-off service is not edited (reopen it first, on the web). Deleting asks a question first and sends one `DELETE` with the version; the server refuses while the service has payments, and its sentence is shown in the question. **No Undo after a delete**: the phone has no undo pattern and the question is the safeguard (the web's Undo toast stays a web convenience). Write off, reopen and move to another client stay on the web.

## Amendment, 2026-11-11: lend, borrow and repay (slice 6)

Accepted by the owner in chat on 2026-11-11: follow the web version. A person's screen (Loans, then a person) has one filled button on its balance card, **Record repayment** while any loan is open and **Lend money** otherwise, never for an archived person, and a ⋮ button beside it that opens a sheet of rows: **Lend money** (only while a loan is open, because it is then not the filled button) and **Borrow money**. The owner chose to include Borrow because it is the same sheet with the money moving the other way, so there is no separate slice for it. One sheet serves the three: an amount that starts empty (a repayment is not prefilled), the account (**Paid from** for a lend and for a repayment of what you owe, **Received into** for a borrow and for a repayment of what they owe you), a **Currency** row only for a repayment when several loans are open (and then only accounts in that currency are offered), and the date and a note folded away; no time (the body sends `time: null`, as the web does). With no account chosen the first one offered is used, as on the web. **Save asks first** ("Lend $50.00 to NAME from ACCOUNT.", "Borrow $50.00 from NAME into ACCOUNT.", "Record $50.00 from NAME into ACCOUNT." or "Record $50.00 paid to NAME from ACCOUNT."), and nothing is sent until the answer is yes. It is one idempotent write, `POST /contacts/{id}/loans/lend`, `.../borrow` or `.../repay`, with a key per change reused on a retry; the amount is in the account's currency (a lend or borrow) or the loan's (a repayment), and the phone refuses a repayment above what is open before sending. A `409` or `404` shows the server's sentence and reads the person again; a saved move closes the sheet, reads the balances again and pulls, so the account balance and the person's history update. The account used is remembered for next time, apart from the account of payments. No server change. **Stay on the web:** Waive what is left, Add loan (a new person or an existing loan), changing a balance from before Ledgerline, Rename and Archive.
