# Ledgerline for Android

A native client of the same API as the web app (design: [ADR 0043](../../docs/adr/0043-android-app.md), sync: [ADR 0042](../../docs/adr/0042-sync-and-bearer-tokens.md)). Kotlin, Jetpack Compose, Material 3, Hilt. Version 1 is built in slices; this folder currently holds the server-address screen and sign-in (password and two-factor code) and the lock (the session can be kept on the phone behind the fingerprint or screen lock) and Accounts and Transactions screens over a Room mirror of the ledger (pulled on sign-in, on opening and every 15 minutes in the background), with expenses, income and transfers added, edited and deleted offline through an outbox that is sent when the phone is online, under a bottom bar (Home, with this month read online above the accounts, Transactions, Budgets, Insights, More) with privacy mode and screenshots blocked unless allowed in More.

- `app/`: the application (`app.ledgerline.android`, minimum Android 11).
- `api-client/`: the API types and the Retrofit interface, written by hand and checked against `docs/openapi.json` by a contract test.

## Build and test

You need a JDK 17 and the Android command-line SDK (platform 37 and its build-tools); point `sdk.dir` in an untracked `local.properties` at the SDK.

```bash
cd apps/android
./gradlew :api-client:test :app:testDebugUnitTest   # unit tests and the contract test
./gradlew :app:assembleDebug                        # app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:assembleRelease :app:lintDebug       # shrunk release build and Android lint
node ../../infra/scripts/android-tokens.mjs         # after changing packages/ui/src/tokens.css
```

To try a build on a phone against a scratch server, connect it by USB with USB debugging on and run `adb reverse tcp:<port> tcp:<port>`, then use `http://localhost:<port>` as the address; the scratch server's `APP_URL` must be exactly that address. The tunnel runs over USB, so airplane mode does not take the app offline: remove the tunnel (`adb reverse --remove tcp:<port>`) to test offline behaviour. `adb` is in the SDK's `platform-tools` folder.

### Comparing the mirror with a scratch server

`MirrorMatchesServerTest` pulls a real server's ledger with the app's own engine and compares every balance and entry with the API, before and after it changes rows. It **writes** to the ledger, so point it only at a scratch server with synthetic data, never production:

```bash
LEDGERLINE_COMPARE_ORIGIN=http://localhost:3101 LEDGERLINE_COMPARE_EMAIL=owner@example.com \
LEDGERLINE_COMPARE_PASSWORD=... LEDGERLINE_COMPARE_TOTP='<secret or otpauth:// URI>' \
./gradlew :app:testDebugUnitTest --tests '*MirrorMatchesServerTest' --rerun
```

Without `LEDGERLINE_COMPARE_ORIGIN` the test is skipped (as in CI). `LEDGERLINE_COMPARE_TOTP` is needed only when the account has two-factor on.

The debug build installs as "Ledgerline debug" (`app.ledgerline.android.debug`), next to the release build; a debug app installed before that change has the release id (`app.ledgerline.android`) and must be uninstalled once (`adb uninstall app.ledgerline.android`; it holds only scratch data, so send or discard any unsent change first). A debug build may be pointed at a server over plain HTTP (to try a scratch server); a release build accepts only `https://`. Never commit a keystore, `local.properties` or a real server address.
