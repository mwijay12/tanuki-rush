# Tanuki Rush — Mobile Edition 🍃

A fast, offline 3D downhill runner for the browser and Android. Ride the leaf board through Hillside City, collect leaves, dodge traffic, boost and try to beat your best time.

The original **TANUKI RUSH** game is by [tanuu5](https://github.com/tanuu5/tanuki-rush), MIT © 2026. This project adds the Flutter Android shell, English mobile UI, offline progression and build pipeline. See [NOTICE.md](NOTICE.md) and [LICENSE-tanuki-rush](LICENSE-tanuki-rush).

## Play

- **Start a run:** steer left/right, jump (jump again in the air to home in on an enemy), and boost. On touch screens, put your thumb anywhere on the left half, **hold and drag** left or right, and release to center; use the buttons on the right with your other thumb. Adjust touch steering sensitivity in Settings. On a keyboard use arrows/A–D, Space/J and Shift/K.
- **Crash or fall:** each run has one optional, free **REVIVE FREE** at the last checkpoint. Score, collected leaves and time are kept; the revive cannot be used again until a new run. **RETRY FROM START** begins a fresh run. Collected leaves refill boost and contribute to score, but no longer absorb crashes. Boosting can still smash obstacles.
- **Keep improving:** beat your local best time and aim for the next rank.
- **Daily runs:** three goals rotate with your device's local date. Finish a run to earn leaf tokens; complete goals for a bonus. Each goal pays once per day.
- **Trail shop:** unlock boost particle colours with tokens earned in-game. Trails are cosmetic and do not affect speed. No purchases or account are needed.
- **Reminders:** optional on Android, off by default; enable them explicitly in Settings.

Android progress is stored offline in an **app-private SQLite database**. The browser edition uses `localStorage`. There is no app-managed backup, online leaderboard or cloud sync; clearing app data or uninstalling can erase progress. The Android game still renders in a WebView, not a fully native 3D engine.

### Run the browser version locally

Requires Node.js 22+.

```bash
cd tanuki-rush
npm ci
npm test
npm run dev -- --host 0.0.0.0
```

Open the URL printed by Vite. Rotate a phone to landscape. The game needs WebGL2; performance depends on the device and browser. Settings includes a lower graphics quality option.

### Published web build

[`.github/workflows/web.yml`](.github/workflows/web.yml) tests the game, builds it, and publishes `tanuki-rush/dist` to GitHub Pages on pushes to `main` and on demand. Pages has to be switched on once in **Settings → Pages → Source: GitHub Actions** — a CI token cannot do it. This is the reliable way to play on a phone while the Android startup hang is open: the browser build has no Flutter engine in front of it, so it cannot hang before its first frame.

## Android APK

Download the newest Android **pre-release** from the [Releases page](https://github.com/mwijay12/tanuki-rush/releases). Preview 1.0.1 addresses an Android WebView setting that blocked drag steering. GitHub Actions also builds an artifact named `tanuki-rush-android-preview` on branch pushes. See [docs/PREVIEW_RELEASE.md](docs/PREVIEW_RELEASE.md) before installing an early build.

**Known issue:** the app can hang on an empty blue screen before Flutter draws anything. The CI boot test has now seen it on two different emulator images — Android 16 (API 36) once on 1.0.5, and Android 14 (API 34) once after three consecutive passes — so it is intermittent rather than tied to one Android version, and a single green boot test proves nothing. Android 17 (API 37) cannot be boot-tested at all — the emulator action cannot bring up that image on the CI runners, which the test now proves by annotating every other failure path and still emitting nothing for API 37 — so Android 15 (API 35) is tested instead. Preview 1.0.6 adds a native watchdog that replaces the dead blue screen with an on-screen explanation (device, Android version, wait time) plus Retry and Close; the hang itself is still open. Until it is closed, the browser build below is the reliable way to play on a new phone.

**Preview signing is not production signing.** The current build uses an Android debug key. CI can generate a different key for each build, so updating an installed preview may require uninstalling it first, which deletes local progress. It is not suitable for a Play Store upload. Set up a securely backed-up release keystore and test on real phones before production.

### Build from source

Requires Node 22, Python 3, Java 17, Flutter 3.47.9 and Android SDK components for platforms 34 and 36, build-tools 36.0.0 and NDK 27.3.13750724.

```bash
# From the repository root, after editing the game:
python3 tools/build_web_assets.py

cd mobile
flutter pub get
flutter analyze --no-pub
flutter test --no-pub
dart run tool/verify_asset_server.dart
flutter build apk --release --no-pub --target-platform android-arm,android-arm64
# mobile/build/app/outputs/flutter-apk/app-release.apk
```

The asset script installs the locked npm dependencies and builds the game. Fonts and license notices are already in `tanuki-rush/public/`; it does not fetch Google Fonts. Keep the generated `mobile/assets/web/` in sync with source. Both ARM ABIs are included; x86 emulators need a different build target.

### CI and preview releases

The root workflow [`.github/workflows/android.yml`](.github/workflows/android.yml) tests the game and the SQLite helper (Robolectric), rebuilds/checks the offline assets, exercises touch, audio, crash/revive and the storage bridge in Chrome, tests Flutter's bridge and native UI, checks the asset server, and builds an APK. The APK must then paint its first Flutter frame on an API 34 emulator; separate diagnostic legs run the same boot test on API 36 and 37, where the startup hang currently reproduces. After rebuilding, run `CHROME_BIN=/path/to/google-chrome npm --prefix tanuki-rush run test:touch`, `test:audio`, `test:gameover` and `test:storage` locally. These checks do not replace a physical Android playthrough. A normal branch push produces an Actions artifact; a commit containing `[release-preview]` also publishes a uniquely tagged **pre-release** with its SHA-256 checksum.

### Why the app runs a loopback server

Chromium WebView cannot reliably load the Vite ES-module graph and `localStorage` from `file://`. The Flutter shell serves allowlisted game assets on `http://127.0.0.1:43853/`; play does not need internet. The **fixed port is intentional**: the old save and the pending-write journal are keyed to the full origin, including its port. If it is occupied, startup fails with a retry screen rather than switching origins. Navigation is limited to this origin.

On a compatible in-place update, the app migrates the old save from that origin once, transactionally, into SQLite. Old keys are retained; SQLite is authoritative afterwards. A pending-write journal, native status/retry UI and a warning on unsaved exit reduce the risk of lost changes. **Settings → Device storage → Details** shows the status. If the database or migration cannot be opened safely, startup stops instead of silently resetting progress. Older random-origin saves cannot be automatically discovered, and a differently signed APK may require uninstalling first, which prevents migration. See [docs/DATABASE.md](docs/DATABASE.md); verify migration and persistence on a physical device.

## Database recommendation

For **leaderboards and cross-device sync**, start with **Supabase**: Postgres makes ranking queries natural, and its authentication, API and row-level security are in one service. Firebase is a good alternative if the team prefers its mobile SDKs and document model. Neon is a good Postgres host, but usually needs separate auth and API components, so it is less turnkey for this project.

The current game is intentionally **offline-first** and no Supabase project is connected. When online features are agreed on, create a project, use anonymous authentication without a sign-up wall, design public-safe leaderboard views and row-level policies, and add opt-in sync with a privacy policy. Client-reported scores can be forged; validate/rate-limit submissions on a trusted backend before treating rankings as competitive. Never put a service-role key in the app or repository. Pricing and free-tier limits can change, so check them before launch. See [docs/DATABASE.md](docs/DATABASE.md).

## Project map

- `tanuki-rush/` — Three.js game source, UI and offline progression tests.
- `mobile/` — Flutter Android shell, bundled web assets and asset-server checks.
- `tools/build_web_assets.py` — reproducible web bundle and license checks.
- `.github/workflows/android.yml` — APK artifact and opt-in preview release.
- `docs/MWONGOZO.md` — mwongozo kwa Kiswahili.

## License

Mobile edition: [MIT](LICENSE). Original game: [MIT © 2026 たぬ](LICENSE-tanuki-rush). Third-party notices and bundled font licenses: [NOTICE.md](NOTICE.md).
