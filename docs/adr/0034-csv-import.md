# ADR 0034: CSV import

Date: 2026-10-18. Status: accepted by the owner when approving the design in chat (the five recommended choices), with a template download placed next to the Import button.

## Context

Phase 3 ends with importing bank statements. The owner's rule from ADR 0033 holds here too: no CSV file is kept on the server. The gate for the phase is that imported statements match the bank.

## Decisions

- **The file never reaches the server.** The web app reads the CSV in the browser, maps its columns and sends the mapped rows as JSON: `date`, optional `time`, `kind` (`expense` or `income`), `amount` (positive minor units in the account's currency), a `categoryId`, `payee`, `note`, `status`, and the file's `id` when it came from an export. A row also carries its `line` number so messages can point at it. Android can do the same on the phone. The two import routes accept bodies up to 4 MB; one import holds at most 5,000 rows.
- **Four steps, nothing kept until confirm.** Choose a file and the target account, map the columns, preview, confirm. `POST /imports/preview` checks rows and writes nothing; `POST /imports` saves them. The server keeps nothing between the two, and confirm re-checks every row (category exists, is active and matches the direction; the account is active and the owner's own; a foreign-currency account needs a stored rate for the date).
- **Rows are income and expense only in this version.** Transfer and split rows of an exported file are shown as "not supported yet" in the preview and skipped by the web app. Round-tripping them is a follow-up.
- **Categories are mapped, never created.** Names in the file that match none of the owner's categories are mapped to one of them (or a default for expenses and one for income) in the preview. The server only ever receives category ids.
- **Duplicates are flagged, not blocked.** A row is a possible duplicate when its `id` is an existing live entry of the ledger, or when its account, date and signed amount equal an existing entry; each existing entry matches at most one row. The web app leaves duplicates unticked; a duplicate sent to confirm is saved because the owner included it, and counted in `duplicatesIncluded`.
- **One batch, all or nothing, undoable.** A confirmed import writes an `import_batches` row (account, file name only, row count, who, a version, the usual timestamps) and its entries, which point back through the nullable `transactions.import_batch_id` (migration 0024; an imported entry is a plain income or expense entry). One idempotent write; any bad row stops it and the message names the line. `POST /imports/{id}/undo` (with `expectedVersion`) soft-deletes whatever is left of the batch, leaves entries already deleted as they are, and retires the batch. `GET /imports` lists the 20 newest batches with how many entries each still has.
- **Saved column mappings stay on the device** (browser storage) in this version. No table, no sync with Android yet; revisit when Android needs it.
- **Backup and restore.** The manifest fingerprints `import_batches` like every other table, a derived `imports` check records live and undone batches and their live and deleted entries, and the restore drill's `import_links` invariant requires every batch entry to have its batch in the same ledger, every batch to hold exactly the entries it recorded, and an undone batch to have no live entry left. The scratch drill (seed with a live and an undone batch) and a negative case cover it.
- **Privacy.** Logs record that an import happened, never row content, payees, notes or the file name; the file name is stored only in `import_batches.source_name`, so the history list can show it.
