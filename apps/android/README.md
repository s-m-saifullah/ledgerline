# Ledgerline for Android

A native client of the same API as the web app (design: [ADR 0043](../../docs/adr/0043-android-app.md), sync: [ADR 0042](../../docs/adr/0042-sync-and-bearer-tokens.md)). Kotlin, Jetpack Compose, Material 3, Hilt. Version 1 is built in slices; this folder currently holds the skeleton and the server-address screen.

- `app/`: the application (`app.ledgerline.android`, minimum Android 10).
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

A debug build may be pointed at a server over plain HTTP (to try a scratch server); a release build accepts only `https://`. Never commit a keystore, `local.properties` or a real server address.
