# Portfolio notes — Tanuki Rush for Android

Copy-paste material for a CV, a GitHub README, or an interview. Everything here is
verifiable from the repository; nothing is estimated.

---

## One-liner

> Took an open-source Three.js browser game and shipped it as an offline Android app
> with a Flutter shell, a loopback asset server, and a reproducible build pipeline.

## Short paragraph (CV)

**Tanuki Rush — Android port** · Flutter, Dart, Android, Vite, Three.js
Packaged an MIT-licensed browser game ([tanuu5/tanuki-rush](https://github.com/tanuu5/tanuki-rush))
as a native Android application. Diagnosed that Chromium refuses to load the game's
code-split ES modules from a `file://` origin, and solved it with an in-process HTTP
server on `127.0.0.1` that serves only bundled assets — preserving `localStorage`
records and module semantics without a network dependency. Added landscape lock,
immersive fullscreen, a back-button policy, offline font bundling, a scoped
cleartext-traffic policy for loopback only, and 17 dependency-free checks covering
MIME handling, path traversal and port isolation.

## Swahili version (kwa CV ya Tanzania)

**Tanuki Rush — Toleo la Android** · Flutter, Dart, Android
Nilichukua mchezo wa browser ulioandikwa kwa Three.js na kuufanya app ya Android
inayochezeka offline. Niligundua kuwa Chromium haiwezi kupakia ES modules za mchezo
kutoka `file://`, kwa hiyo nilijenga server ndogo ya HTTP ndani ya app inayohudumia
assets kwenye `127.0.0.1` pekee. Nikaongeza landscape lock, fullscreen, udhibiti wa
kitufe cha kurudi, fonts za offline, na vipimo 17 vya kujitegemea.

## Engineering decisions worth discussing

1. **The `file://` problem.** The naive wrapper fails silently: Vite emits
   `<script type="module" crossorigin>`, and a module script from an opaque origin is
   blocked by CORS. Symptom is a blank black screen with no useful error. Verified by
   inspecting the built `index.html` before writing any Dart.
2. **Why not fix the build instead?** Forcing a single IIFE bundle would work around
   the symptom but still leaves `localStorage` unreliable on `file://`, which the game
   needs for best times. The loopback server fixes the origin problem once, for
   modules, storage and fonts alike.
3. **Port `0`, not a fixed port.** The OS assigns a free ephemeral port, so a second
   instance of the app cannot collide with the first.
4. **Serve from an explicit index, not a directory listing.** The asset list is
   generated at build time (`asset_index.json`) rather than read from Flutter's
   internal `AssetManifest`, whose format has changed between SDK versions.
5. **Honest scoping.** The game is someone else's MIT work. The repository separates
   the inherited work from mine in `NOTICE.md`, and keeps the upstream license text
   alongside the project license. This is the difference between a portfolio piece and
   a credibility problem.

## Verification evidence

| Check | Result |
| --- | --- |
| `flutter analyze` | No issues found |
| `dart tool/verify_asset_server.dart` | 17/17 checks passed |
| Release APK | 29.9 MB, `arm64-v8a` + `armeabi-v7a`, debug-signed |
| Bundled assets | 12 files, all under `assets/web/` |
| Upstream game source | ~490 KB JavaScript, 45 files, no binary assets |

The asset-server checks run without a device or emulator, which is what makes them
useful in CI.

## Roadmap (what a reviewer would ask for next)

1. **Wake lock** — keep the screen on during a run (`wakelock_plus`).
2. **Signed release** — real keystore + `key.properties`, then a Play Store internal
   test track.
3. **Store assets** — the launcher icon is generated (`tools/make_icons.py`), but
   Play Store screenshots and a feature graphic are still missing.
4. **CI** — GitHub Actions running `flutter analyze`, the asset-server checks, and an
   APK build on every push.
5. **Instrumented smoke test** — `flutter drive` that loads the page and asserts the
   canvas is non-blank, to catch WebView regressions on real devices.
6. **Phase two** — a native Flutter + Flame 2D version behind the same shell, as a
   way to move from "wrapper" to "game developer" on the same package name.

## What I would say in an interview

The interesting part was not the wrapper — it was finding out *why* the wrapper
produced a black screen. The failure had no error message, so the work was reading
what Vite emitted, understanding Chromium's origin rules for module scripts, and then
choosing a fix that solved the origin problem rather than patching one symptom. The
second interesting part was restraint: documenting what I did not build.
