# Financial write helpers

Use these helpers for every Phase 1 financial mutation. Authentication endpoints keep their existing handlers.

1. Validate the body with a shared Zod schema. Declare problem responses and the required `Idempotency-Key` in the endpoint's OpenAPI schema.
2. Call `financialWriteIdentity(auth, config, request)` to resolve the signed-in actor, trusted browser origin, ledger ID and key. Never accept an actor ID from the body.
3. Call `runFinancialWrite(db, { ...identity, operation, request: validatedBody }, callback)`. The operation must contain the method and resource target, including the record ID for edits/deletes. Include all query parameters that affect a mutation in the fingerprint request.
4. Run all mutation queries using the callback's `tx` and trusted `ledgerId`, through a scoped repository. Return a JSON-safe success DTO and status; use `{ status: 204, body: null }` for no-content responses. Throw `ApiProblem` for expected failures using fixed, non-sensitive messages.
5. Send the result with `sendFinancialWrite(reply, result)`. It preserves the original status/body and marks replay with `Idempotency-Replayed: true`.

The receipt and mutation commit together. An advisory transaction lock serializes retries for the actor/ledger/key. Ledger and membership share locks prevent access revocation during a committed write; permissions are checked again before replay. Changed requests and tombstoned receipt keys conflict. Failed transactions leave the key available for retry. Receipts have no automatic expiry and must be included in backups.

For editable rows, require `expectedVersion`. Scope updates by ledger, ID, active state **and expected version**, increment the version, and use `requireVersionUpdate(returnedRows)` to detect a concurrent edit. `nextVersion(current, expected)` validates a loaded version but does not replace the SQL version predicate. Apply transfer/split changes in the same transaction.

In the web client, create `prepareFinancialWrite(path, method, body)` once for a user action and reuse its returned function for retries. A changed action needs a new prepared function. `ApiError` exposes status and field details to forms.

Integration tests use probe routes and a disposable table exclusively in `ledgerline_test`; no test endpoint is registered in the production app.
