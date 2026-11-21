# ADR 0056: What is typed on the phone survives Android ending the app

Date: 2026-11-21. Status: accepted by the owner in chat for the scope and the retry key; the privacy handling below was stated to him with them and he did not object. Finishes WP-18 of the review's fixes (WP-18b); the first half, a rotation keeps an open sheet, is in the pull request before it.

## Context

Android may end the app in the background to free memory, and the person finds it open again where they left it. The phone's sheets lived only in view models, so a half-typed payment, service, loan or entry was gone, and so was the retry key of a payment whose answer had been lost: sent again after the restart, the same payment would get a new key and could be recorded twice. [ADR 0050](0050-money-writes-on-the-phone.md) says the sheet keeps what was typed; that held for a rotation (WP-18) but not for this.

## Decision

- **The money sheets and the editor keep a draft.** Record payment (service and client), Log or edit service, Lend, Borrow and Repay, and Add or edit a transaction (including correcting a rejected change) write their form, and what the sheet can choose from, into the activity's saved state on every change, and read it back when the view model is created again. The client or person being looked at is kept too, so a sheet has a screen to show on.
- **The retry key is kept with the form.** `WriteKeys` can keep its keys in the same place, under a hash of the change, never its text. The same change sent again after a restart carries the key it had, so the server does it once.
- **A draft is only shown to its owner.** Each draft records the ledger it belongs to and is dropped, with its keys, if the phone's ledger is another one. The editor's draft also belongs to one opening of the editor (its session), so a new Add starts empty.
- **A draft ends when the work does.** Closing a sheet, a payment going through, a saved entry, and leaving the screen (Back, a tab change, the session ending) all forget it. A rotation, a dark-mode switch or a font-size change do not.
- **A test keeps it that way.** `DraftsAreKeptTest` reads the sources: every sheet keeps its draft and keys and checks the ledger, no write key is made without a place to keep it, and the editor and the two list screens keep theirs.

## What is kept, and where

Saved state is text the system holds for this one activity, so Android can bring it back. The app writes nothing to the phone's storage for it, it is not part of a backup (`allowBackup` is off), and it holds the same things the open sheet shows: typed amounts, a note, names of accounts and categories. It is never logged. The last answer of a rate look-up is not kept (it may be out of date); a restored sheet asks again.

## Not covered

The Budgets limit sheet, the category sheets, Filters and the delete questions keep nothing across a restart. A question has no typed text; the Budgets and category sheets can follow with the same pieces when the owner asks.

## Consequences

- A new money sheet must take a `SavedStateHandle`, use `keepDraft` and `keysDraft`, and drop another ledger's draft; the scan test says so when it does not.
- A change to a form's fields is a change to what an older saved draft holds: an unreadable draft is dropped, never crashed on.
- No server change and no API change; it ships with the next `android-v*` tag.
