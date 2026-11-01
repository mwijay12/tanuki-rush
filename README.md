# Tanuki Rush — Android

Native Android shell that plays **TANUKI RUSH** (a Three.js downhill runner) as an
installed app: no browser chrome, no URL bar, no network, works in airplane mode.

> **Kwa Kiswahili:** hii ni app ya Android inayobeba mchezo wa TANUKI RUSH
> (ulioandikwa na tanuu5 kwa Three.js) na kuufanya uchezeke kama app ya kawaida —
> offline, landscape, fullscreen, bila browser. Kazi yangu ni shell ya Flutter,
> server ndogo ya kuhamisha game, na mipangilio ya Android. Mchezo wenyewe si wangu.

---

## What is mine, what is not

Being explicit about this matters more than the code.

| | Author |
| --- | --- |
| The game: 3D course, tanuki model, city, physics, HUD, music and SFX | **たぬ / [tanuu5](https://github.com/tanuu5/tanuki-rush)** — MIT |
| three.js renderer | three.js authors — MIT |
| Fonts (Exo 2, M PLUS Rounded 1c) | SIL Open Font License 1.1 |
| **Flutter app, loopback asset server, Android config, offline font bundling, build pipeline** | this project |

The game is bundled unmodified apart from one change: its Google Fonts `<link>` is
replaced with self-hosted subsets so it renders offline. See [`NOTICE.md`](NOTICE.md).

## Why there is an HTTP server in a single-player offline game

The obvious approach — load `file:///android_asset/.../index.html` — does not work
here, and the reason is specific:

1. Vite emits `<script type="module" crossorigin>`, and Chromium refuses to load
   module scripts from an opaque `file://` origin.
2. The build code-splits into three chunks (`index`, `TanukiModel`, `AudioEngine`),
   so the module graph cannot simply be inlined away.
3. The game persists best times and settings in `localStorage`, which is unreliable
   on `file://` but normal on a real origin.

Options considered:

| Approach | Verdict |
| --- | --- |
| `file://` + `allowUniversalAccessFromFileURLs` | Rejected — deprecated in modern Chromium, unreliable across WebView versions |
| Rebuild as a single IIFE bundle | Rejected — fights the bundler config and still loses `localStorage` |
| `WebViewAssetLoader` (https scheme) | Works, but needs a platform channel per request |
| **Loopback `HttpServer` on `127.0.0.1`** | **Chosen** — real origin, ES modules and `localStorage` behave normally, ~150 lines of Dart, testable without a device |

The server binds to port `0` (OS-assigned) so two instances never collide, serves
only keys that exist in the bundled asset index, and rejects `..` segments.
Cleartext HTTP is permitted **only** for `127.0.0.1` via
`network_security_config.xml`; every other host stays blocked.

## Project layout

```
mobile/
  lib/
    main.dart               orientation lock, immersive mode, app gate
    game_screen.dart        WebView host, back-button policy, error surface
    web_asset_server.dart   loopback static server (pure Dart, unit-testable)
    game_bootstrap.dart     wires rootBundle into the server
    app_theme.dart          colours matching the game UI
  tool/
    verify_asset_server.dart   17 standalone checks, no device needed
  assets/web/              the compiled game (generated — see below)
  android/                 manifest, network security config, launch theme
tools/
  build_web_assets.py      rebuild the game + self-host fonts + index assets
  make_icons.py            rasterise the launcher icon (legacy + adaptive layers)
  fetch_llvm_strip.py      pull only llvm-strip out of the NDK zip (container builds)
  setup_toolchain.sh       install JDK/Flutter/Android SDK in a bare container
tanuki-rush/               upstream game source (build input)
```

## Build

Requires Flutter (Dart 3.13+) and an Android SDK.

```bash
cd mobile
flutter pub get
flutter build apk --release --target-platform android-arm,android-arm64
# → build/app/outputs/flutter-apk/app-release.apk   (29.9 MB)
```

Both ARM ABIs are built; x86 is skipped because it only matters for emulators.
Install on a device with `adb install -r build/app/outputs/flutter-apk/app-release.apk`.

Verified on the built artefact:

| Property | Value |
| --- | --- |
| Size | 29.9 MB |
| ABIs | `arm64-v8a`, `armeabi-v7a` |
| `applicationId` | `com.tanukirush.tanuki_rush` |
| Label | Tanuki Rush |
| Permissions | `INTERNET` only (loopback socket) |
| Orientation | `sensorLandscape` |
| `isGame` | `true` |
| Signing | Android debug key — see limitations |

### Build environment notes

Three non-default settings exist because of this specific stack, not by accident:

| Setting | Why |
| --- | --- |
| AGP pinned to 8.13.0 (template ships 9.1.0) | `flutter_inappwebview_android` 1.1.3 still calls `getDefaultProguardFile("proguard-android.txt")`, which AGP 9 rejects at configuration time |
| `org.gradle.jvmargs=-Xmx1536m` | The Flutter template asks for `-Xmx8G`; on a 4 GB container Gradle's daemon gets OOM-killed with a misleading "daemon disappeared" error |
| `ndkVersion` pinned to 27.0.12077973 | AGP resolves an NDK even with no native code; naming one version keeps the build reproducible instead of following AGP's default |

A normal machine with Android Studio installed resolves all of this by itself. Inside
a 4 GB container the NDK cannot be unpacked (~1.9 GB), so `tools/fetch_llvm_strip.py`
pulls just `llvm-strip` (5.8 MB) out of the NDK zip via HTTP range requests — that
single binary is the only NDK component a release build needs, and without it
`libflutter.so` ships unstripped at 165 MB instead of 11.7 MB.

The first one is worth knowing about: if `flutter_inappwebview` publishes an AGP 9
compatible release, the pin can be dropped.

### Rebuilding the bundled game

If you change the game source, regenerate the assets rather than editing
`mobile/assets/web/` by hand:

```bash
python3 tools/build_web_assets.py
```

That runs the Vite build, copies `dist/`, downloads and rewrites the font CSS to
local files, and rewrites `asset_index.json`.

## Verification

```bash
cd mobile && dart tool/verify_asset_server.dart
```

Covers MIME types (a module script served as `text/plain` silently fails), the
`/` → `index.html` fallback, `HEAD`, method rejection, unknown assets, path
traversal, and that a second instance binds a different port. `flutter analyze`
runs clean.

## Known limitations

- **No wake lock** — the screen can dim during a run. `wakelock_plus` is the fix.
- **WebView variance** — WebGL performance depends on the device's WebView build.
  High-end phones are fine; very old budget devices may drop frames. The game
  already ships a low/medium/high quality switch on its title screen.
- **Release signing** — the release build is signed with the debug key so it can be
  installed locally. A Play Store upload needs a real keystore.
- **Android only.** iOS would need a Mac, an Apple Developer account, and a WKWebView
  host; the Dart code is portable but untested there.
- **No x86 build.** Emulators on Intel hosts need `--target-platform android-x64`.
- **Not yet run on a physical device.** Everything above was verified by static
  analysis, the asset-server checks, and inspecting the built APK's contents and
  manifest — not by playing it on hardware.

## License

- This project: MIT — see [`LICENSE`](LICENSE).
- Bundled game: MIT © 2026 たぬ — see [`LICENSE-tanuki-rush`](LICENSE-tanuki-rush).
- Third-party components: see [`NOTICE.md`](NOTICE.md).
