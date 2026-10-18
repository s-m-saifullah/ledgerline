# ADR 0031: No receipt or file attachments

Date: 2026-10-18. Status: accepted by the owner when approving the Phase 3 design in chat.

## Context

The plan listed "tags and receipts" in Phase 3 and an `attachments` table among the later entities. Storing photos or PDFs would add private file storage, upload limits, file-type checks and a change to backups and the restore drill, and receipts can hold personal data (names, card digits, addresses).

## Decisions

- **Ledgerline does not store receipt images or any other attached files.** No upload endpoints, no file storage and no `attachments` table. The owner keeps receipts elsewhere and uses the note field for a reference if needed.
- **Phase 3 becomes** reports, tags, CSV export and CSV import.
- **"Receipt" keeps one meaning in the code and the screens:** a recorded payment from a client (`receipt_id`).
- Receipt OCR stays out of scope, as before. Backups stay database-only, so the backup manifest and restore drill need no file checks.
- If this is ever reversed, it needs a new ADR covering storage, backup and restore, and privacy.
