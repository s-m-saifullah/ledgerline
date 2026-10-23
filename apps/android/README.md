# Ledgerline for Android

A native client of the same API as the web app (design: [ADR 0043](../../docs/adr/0043-android-app.md), sync: [ADR 0042](../../docs/adr/0042-sync-and-bearer-tokens.md)). Kotlin, Jetpack Compose, Material 3, Hilt. Version 1 is built in slices; this folder currently holds the server-address screen and sign-in (password and two-factor code) and the lock (the session can be kept on the phone behind the fingerprint or screen lock) and Accounts and Transactions screens over a Room mirror of the ledger (pulled on sign-in, on opening and every 15 minutes in the background), with expenses, income and transfers added, edited and deleted offline through an outbox that is sent when the phone is online, under a bottom bar (Home, with this month read online above the accounts, Transactions, Budgets and Insights, each read online for a month, More, which opens Clients and Loans, read online) with privacy mode and screenshots blocked unless allowed in More.

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
./gradlew :app:testDebugUnitTest --tests '*ScreenshotTest' -Pledgerline.screenshots   # design review PNGs
```

The screenshots (ADR 0045) go to `app/build/outputs/roborazzi`: every main screen at 320 and 390 dp, light and dark, and with the largest text, with made-up data. They are for reviewing the design against the web app and are never committed or compared in CI. The app uses Inter 4.1 (`res/font/inter_variable.ttf`, the same family the web self-hosts); its OFL licence is in `assets/licenses/`.

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

## Releasing the app (signed APK)

A tag `android-vX.Y.Z` on a commit that is on `main` starts the Android release workflow (`.github/workflows/android-release.yml`, [ADR 0043](../../docs/adr/0043-android-app.md), [CI.md](../../docs/CI.md)). It runs the full checks, waits for your approval in the `android-release` environment, builds the release APK signed with your key, verifies the signature and publishes a GitHub Release with the APK and its SHA-256. The version name is `X.Y.Z` and the version code `X*10000 + Y*100 + Z` (`infra/scripts/android-version.mjs`; minor and patch stay below 100), so every later release can be installed over the earlier one. Pull requests and the debug build never see the key: the release build stays unsigned unless `LEDGERLINE_KEYSTORE_FILE`, `LEDGERLINE_KEYSTORE_PASSWORD`, `LEDGERLINE_KEY_ALIAS` and `LEDGERLINE_KEY_PASSWORD` are all set.

### One-time setup (the owner)

1. **Create the key** on your own computer, with long random passwords from your password manager. A lost key means no update can ever be installed over the app (uninstall and reinstall, after sending every change), so do the backup in step 2 before anything else.

   ```bash
   keytool -genkeypair -v -keystore ledgerline-release.jks -storetype PKCS12 -alias ledgerline \
     -keyalg RSA -keysize 4096 -validity 10950
   keytool -list -v -keystore ledgerline-release.jks -alias ledgerline | grep 'SHA256:'   # the certificate fingerprint
   ```

2. **Back it up** encrypted with your age public key, as the off-site backups are, and keep a copy in the password manager. Put the keystore and a text file with its alias and both passwords in one archive, then prove the backup works by restoring it into a temporary folder and comparing the fingerprint:

   ```bash
   tar -cf ledgerline-android-key.tar ledgerline-release.jks ledgerline-release-passwords.txt
   age -r <your age public key> -o ledgerline-android-key.tar.age ledgerline-android-key.tar
   age -d -i <your age identity file> ledgerline-android-key.tar.age | tar -xf - -C "$(mktemp -d)"   # then keytool -list on the copy
   ```

   Delete the unencrypted tar and the password file afterwards.
3. **Create the environment.** In the repository settings add an environment `android-release` with you as the required reviewer, and limit it to the tags `android-v*`. Do not reuse `production`.
4. **Add the secrets** to that environment (not to the repository): `ANDROID_KEYSTORE_BASE64` (the keystore, base64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. For example `base64 -i ledgerline-release.jks | gh secret set ANDROID_KEYSTORE_BASE64 --env android-release`, and `gh secret set <NAME> --env android-release` (it prompts, so nothing lands in the shell history) for the rest.
5. **Pin the certificate.** Add the fingerprint as the repository variable `ANDROID_CERT_SHA256` (`gh variable set ANDROID_CERT_SHA256 --body '<fingerprint>'`). The workflow then refuses an APK signed with any other key. After the first release, write the fingerprint here too, so a downloaded APK can be checked against it: `apksigner verify --print-certs ledgerline-android-X.Y.Z.apk`.

### Releasing

```bash
git switch main && git pull
git tag -a android-v0.1.0 -m "Ledgerline for Android 0.1.0"
git push origin android-v0.1.0
```

Approve the run in the Actions tab when the checks have passed. On the phone, download the APK from the GitHub Release, compare its SHA-256 with the release notes, and install it over the app. The debug build ("Ledgerline debug") can stay installed beside it. A server release is not needed.
