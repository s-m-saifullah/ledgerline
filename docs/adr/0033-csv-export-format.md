# ADR 0033: CSV export format, and no stored files

Date: 2026-10-18. Status: accepted by the owner when approving the design in chat, with the rule that no CSV file is ever stored on the server.

## Context

Phase 3 adds CSV export, and later CSV import. One file format serves both: what Ledgerline exports, it can read back. Exports hold the owner's whole financial history, so how they are made matters as much as what they contain.

## Decisions

- **Generated on demand, never stored.** An export is built row by row while it is sent to the browser, from one read-only snapshot of the database. It is not written to disk, a temporary folder, the database or any cache, so nothing exists on the server once the download ends or is abandoned (the owner's rule is "deleted within 10 minutes"; the file lives for seconds, in memory in transit). Responses carry `Cache-Control: no-store` and `Content-Disposition: attachment`. An export that runs longer than two minutes is cut off. Import, when built, follows the same rule for uploads: parsed in memory, never saved.
- **Format.** UTF-8 with a byte-order mark (so spreadsheets read accents correctly; import ignores it), CRLF line endings, RFC 4180 quoting, one header row.
- **Transactions columns** (`packages/shared/src/exports.ts`): `id, date, time, type, amount, currency, account, to_account, received_amount, category, subcategory, payee, note, status, line, fx_rate, base_amount`. Names, not ids, identify accounts and categories; `category` is the top-level category and `subcategory` the child (empty when the entry uses a top-level one).
- **Amounts** are positive decimal text in each currency's own digits (`12.50`, `1200` for yen, `1.234` for dinar), and `type` (`income`, `expense`, `transfer`) is the direction. `fx_rate` and `base_amount` are the values frozen when the entry was saved (ADR 0020, 0022).
- **A transfer is one row**, its sending leg: `account` is where it left, `to_account` where it arrived, `received_amount` is filled only when the two currencies differ. A transfer's fee and bonus are ordinary expense and income rows (ADR 0023, 0025); there is no link column in this version.
- **A split entry is one row per line**, sharing the entry's `id` and numbered in `line` (1, 2, …), each with its own category, amount and base amount; a line's note falls back to the entry's note. Other rows leave `line` empty.
- **Rows** are cleared and pending entries (`status`), never deleted ones, oldest first (date, then id). Filters are the Transactions list filters and apply to whole entries, so a split entry matched by one line keeps all its lines. An account filter also keeps a transfer that arrives in that account.
- **Spreadsheet formulas.** Text that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe on export; import removes one leading apostrophe in front of those characters. Amount and rate cells are numbers and never need it.
- **Accounts and categories files.** `id, name, type, currency, opening_balance, archived` and `id, name, parent, kind, color, archived`, every non-deleted row, archived ones included.
- **Access and privacy.** Any member who can read the ledger can export it; another ledger returns 404. Logs record that a request happened, never its filters, amounts, payees or notes (the request line is not logged). No migration, no new table and nothing for the backup manifest to cover.
