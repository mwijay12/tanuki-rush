# Tanuki Rush — Mobile Edition 🍃

A fast, offline 3D downhill runner for the browser and Android. Ride the leaf board through Hillside City, collect leaves, dodge traffic, boost and try to beat your best time.

The original **TANUKI RUSH** game is by [tanuu5](https://github.com/tanuu5/tanuki-rush), MIT © 2026. This project adds the Flutter Android shell, English mobile UI, offline progression and build pipeline. See [NOTICE.md](NOTICE.md) and [LICENSE-tanuki-rush](LICENSE-tanuki-rush).

## Play

- **Start a run:** steer left/right, jump (jump again in the air to home in on an enemy), and boost. On touch screens, drag on the left and use the buttons on the right. On a keyboard use arrows/A–D, Space/J and Shift/K.
- **Keep improving:** beat your local best time and aim for the next rank.
- **Daily runs:** three goals rotate with your device's local date. Finish a run to earn leaf tokens; complete goals for a bonus. Each goal pays once per day.
- **Trail shop:** unlock boost particle colours with tokens earned in-game. Trails are cosmetic and do not affect speed. No purchases or account are needed.
- **Reminders:** optional on Android, off by default; enable them explicitly in Settings.

Progress is stored **on this device only**. Clearing browser/app data or uninstalling the app removes it. No online leaderboard or cloud backup is connected yet.

### Run the browser version locally

Requires Node.js 22+.

```bash
cd tanuki-rush
npm ci
npm test
npm run dev -- --host 0.0.0.0
```

Open the URL printed by Vite. Rotate a phone to landscape. The game needs WebGL2; performance depends on the device and browser. Settings includes a lower graphics quality option.

## Android APK

Download the [Android preview release](https://github.com/mwijay12/tanuki-rush/releases/tag/preview-d662b6729f) or check the [Releases page](https://github.com/mwijay12/tanuki-rush/releases) for newer versions. GitHub Actions also builds an artifact named `tanuki-rush-android-preview` on branch pushes. See [docs/PREVIEW_RELEASE.md](docs/PREVIEW_RELEASE.md) before installing an early build.

**Preview signing is not production signing.** The current build uses an Android debug key. CI can generate a different key for each build, so updating an installed preview may require uninstalling it first, which deletes local progress. It is not suitable for a Play Store upload. Set up a securely backed-up release keystore and test on real phones before production.

### Build from source

Requires Node 22, Python 3, Java 17, Flutter 3.47.9 and Android SDK components for platforms 34 and 36, build-tools 36.0.0 and NDK 27.3.13750724.

```bash
# From the repository root, after editing the game:
python3 tools/build_web_assets.py

cd mobile
flutter pub get
flutter analyze --no-pub
dart run tool/verify_asset_server.dart
flutter build apk --release --no-pub --target-platform android-arm,android-arm64
# mobile/build/app/outputs/flutter-apk/app-release.apk
```

The asset script installs the locked npm dependencies and builds the game. Fonts and license notices are already in `tanuki-rush/public/`; it does not fetch Google Fonts. Keep the generated `mobile/assets/web/` in sync with source. Both ARM ABIs are included; x86 emulators need a different build target.

### CI and preview releases

The root workflow [`.github/workflows/android.yml`](.github/workflows/android.yml) tests the game, rebuilds and checks the offline assets, runs Flutter analysis and asset-server checks, and builds an APK. A normal branch push produces a downloadable Actions artifact. A push commit containing `[release-preview]` additionally publishes a uniquely tagged **pre-release** with the APK and its SHA-256 checksum. A pre-release should still be tested on real Android hardware before it is treated as a real release.

### Why the app runs a loopback server

Chromium WebView cannot reliably load the Vite ES-module graph and `localStorage` from `file://`. The Flutter shell serves an allowlisted copy of the game on `http://127.0.0.1:43853/`; it does not need an internet connection to play. The **fixed port is intentional**: storage is keyed to the whole origin, including the port. If that port is occupied, startup fails with a retry screen rather than silently switching origins and losing sight of the save. WebView navigation is limited to this exact origin.

Older development builds used random ports, so their old per-port saves cannot automatically be recovered by this build. Changing the fixed port later will also strand existing saves. The in-app server and origin behavior have standalone Dart checks; persistence on a physical device still needs verification.

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
