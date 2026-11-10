# ADR 0050: Money writes on the phone (Android)

Date: 2026-11-09. Status: accepted by the owner in chat on 2026-11-09 (scope, payments in other currencies, marking a service paid, the keypad, the sign-in message). Amends [0043](0043-android-app.md), which left adding loans and logging services on the web, and carries out the follow-ups listed in [0046](0046-clutter-free-redesign.md). Builds on [0042](0042-sync-and-bearer-tokens.md) (idempotent writes) and [0048](0048-profile-and-managed-users.md) (the temporary password).

## Context

The phone reads Clients and Loans but cannot change them: its screens say "stays on the web". The web can receive a payment, log a service, lend more and record a repayment, and the server routes for all of them already exist. Setting and removing a budget limit already works on the phone (#186). **Production has a real user. Nothing existing may change.**

## Decisions

- **In scope, on the phone:** receive a payment, mark a service paid, log a service, lend more and record a repayment. Budget limits are done.
- **Still web only:** adding, renaming and archiving a client or person; reorder, merge, the starter set and icon and colour for categories; tags created on the phone; Profile and Change password; Users and Recently deleted (ADRs 0048 and 0049 stand); Clear ledger and its undo; receipts; send reminder; Auto-Set Limits.
- **Online writes, no outbox.** Each write is one idempotent REST call with an `Idempotency-Key` that is made once per change and sent again on a retry, as category and budget writes already do. Nothing is queued: a payment needs the server's balances and rates. Offline, the sheet says so and keeps what was typed. A `409` version conflict reloads the screen and says so.
- **The web's rules, not new ones.** A payment in another currency follows the web: the amount received, the rate, a tip, and manual rates are never overwritten. The sheet asks a question before it sends (a confirmation, not one tap), as ADR 0046 says. The phone computes nothing the server will not check again.
- **Mark paid is the receive-payment sheet** with the outstanding amount filled in, opened by one tap on an unpaid service. There is one write path.
- **The in-app keypad is not built.** The editor keeps the system keyboard and cents-first typing (ADR 0046); ADR 0047's "not decided" becomes "not built".
- **A person on a temporary password who signs in on the phone** is told why nothing loads. Sign-in succeeds (the sign-in routes are open), then every data route answers `403`, and the phone showed only "Could not update". After sign-in the app reads `GET /api/v1/me`, which that person may call; when `mustChangePassword` is true it says "Choose a new password on the web, then sign in here again." and signs out. Changing the password stays on the web.
- **The design rules of ADR 0046 apply:** screens from `ui/design`, the 10 sp text floor, 4.5:1 contrast, 48 dp targets, the single teal accent, one short hint per row.

## API

No server change is planned: `POST /receivables/{id}/payments`, `POST /receivables`, `POST /contacts/{id}/loans/lend` and `.../repay`, and `GET /me` exist. The phone's hand-written types gain each route's request and reply, each with a case in the contract test against `openapi.json`.

## Keeping production safe

- The writes change real money rows, so they are tried only against a scratch server (never his dev servers or production) and compared with the web's balances.
- Each slice is its own pull request with tests that fail first, a deliberate-mutation check on each new rule and screenshots at 320 and 390 dp, light and dark, and with the largest text; sheets are checked on his phone before the next slice.
- Android releases are his to tag. The next one also carries AGP 9.5.0, Roborazzi 1.77.0 and `clearedAt`.

## Slices

1. This ADR and the PROGRESS correction (documentation only).
2. The sign-in message for a temporary password.
3. The shared online-write helper and the money sheet.
4. Receive payment, with other currencies and a tip; mark paid.
5. Log service.
6. Lend more and Repay.
