# ADR 0015: Services carry an optional local time

Date: 2026-10-08. Status: accepted, requested by the owner.

Log service gets an optional time like transactions (ADR 0004) and payments. A nullable `receivables.service_time` stores local `HH:mm` with no timezone conversion; a check constraint enforces the format (migration 0010, additive, existing services read back `null`).

API: create may omit `serviceTime` (kept out of the write fingerprint so pre-upgrade retries replay); PATCH omitted keeps the saved time and `null` clears it. Service DTOs and history snapshots add `serviceTime`; history written before the migration defaults to `null`. Receipt allocation still orders by service date then ID, so time never changes which service a payment pays first.

Compatibility: a `v0.0.5` API still reads and writes migrated services, because the column is nullable and unused by it. OpenAPI and API notes advance to 0.1.14.
