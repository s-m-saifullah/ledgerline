# ADR 0013: Seven-day trial and a blank production ledger

Date: 2026-10-08. Status: accepted, requested by the owner while approving the release plan.

## Decisions

- The Phase 1 gate shortens from two weeks to **seven consecutive days** of the owner logging every expense. All other gate rules (stop-and-fix hotfixes, restart if logging was impossible for a full day) are unchanged.
- Production starts the trial from a **blank slate**: after the verified pre-deploy backup, existing ledger data is removed, keeping the owner login, ledger and membership. This is a deliberate, owner-requested hard delete of financial rows (an exception to soft deletion for this one reset only) and is recoverable only from that backup.
- A daily on-server backup (seven-day retention) and a weekly restore drill run during the trial; off-site backups remain Phase 4.

## Consequences

PLAN.md and PHASE_1_PLAN.md now say seven days. Wiping needs its own explicit authorization at execution time. With no data before the deploy, upgrade safety of migrations 0006-0009 over real v0.0.5 data rests on the synthetic upgrade test in the release plan.
