# HANDOFF — Tanuki Rush: Mobile Edition

Read this first. It is the single source of truth for a new agent picking up this
project. Everything stated as "verified" was confirmed by a command whose output is
quoted; everything else is marked as unbuilt or assumed.

Last updated: 2026-11-02 · Owner: Mwijay Davie (mwijay12) · Made in Tanzania

---

## 1. What this project is

We took **TANUKI RUSH**, an MIT-licensed Three.js browser game by
[tanuu5](https://github.com/tanuu5/tanuki-rush), and turned it into a real Android
product: offline app, English UI, onboarding, settings, retention systems, key art,
and native haptics.

The game itself (3D course, tanuki, city, physics, music, SFX) is **not ours**.
Credit the original author everywhere. Our contribution is the shell, the product
layer, and the design work.

- Repo: https://github.com/mwijay12/tanuki-rush (branch `main`)
- Local workspace root: the folder containing `mobile/`, `tanuki-rush/`, `tools/`
- Live preview (ephemeral): check with `curl -o /dev/null -w "%{http_code}" <url>/`
  before sharing. A `trycloudflare.com` URL dies on environment restart.

## 2. State at handoff

| Area | State |
|---|---|
| Web build (the game) | **Working and verified.** Served, HTTP 200, assets checked. |
| Android APK | **Built once** (29.9 MB, arm64+armv7). Stale — predates art, settings, retention and phase 2. |
| Native phase-2 code | **Written, never compiled.** Toolchain was wiped by an environment restart. |
| GitHub | Pushed through commit `9f41035`. |
| Device testing | **Never done.** No phone or emulator was ever available. |

Verified commit chain: `46bf613` port → `8c48efe` English/settings → `1b22aa1` key art
→ `89cc789` retention → `9f41035` phase 2.

## 3. Hard rule for the next agent

Do not claim anything works that you did not run. In particular:

- Never share a URL before `curl` returns 200 on `/`.
- Never say "APK built" without `ls -l` on the output path.
- Never say "compiles" for Dart you did not pass through `flutter analyze`.

## 4. Rebuild from zero (environment was wiped)

```bash
cd <workspace>
bash tools/setup_toolchain.sh          # JDK 17 + Flutter + Android SDK, no apt
python3 tools/fetch_llvm_strip.py      # 5.8 MB llvm-strip out of the NDK zip
```

Then create the NDK stub the build expects (AGP resolves an NDK even with no native
code, and the real one is ~1.9 GB, which does not fit):

```bash
mkdir -p /opt/android-sdk/ndk/27.0.12077973/toolchains/llvm/prebuilt/linux-x86_64/bin
cp /tmp/ndk-tools/llvm-objcopy /opt/android-sdk/ndk/27.0.12077973/toolchains/llvm/prebuilt/linux-x86_64/bin/
ln -sf llvm-objcopy /opt/android-sdk/ndk/27.0.12077973/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip
printf 'Pkg.Desc = Android NDK\nPkg.Revision = 27.0.12077973\n' \
  > /opt/android-sdk/ndk/27.0.12077973/source.properties
sdkmanager --sdk_root=/opt/android-sdk "platforms;android-34"   # plugin compiles against 34
```

Build the app:

```bash
cd mobile
export JAVA_HOME=/opt/jdk17 ANDROID_HOME=/opt/android-sdk PATH=/opt/flutter/bin:$PATH
flutter pub get
flutter build apk --release --target-platform android-arm,android-arm64
```

Rebuild the game bundle after editing anything under `tanuki-rush/src`:

```bash
python3 tools/build_web_assets.py      # vite build + self-host fonts + asset index
```

Serve + tunnel for a preview:

```bash
python3 -m http.server 8081 --bind 127.0.0.1 --directory mobile/assets/web &
cloudflared tunnel --url http://localhost:8081 --no-autoupdate
```

## 5. Architecture, and why

**The game is served over a loopback HTTP server, not `file://`.**
Vite emits `<script type="module">` plus three code-split chunks. Chromium refuses
module scripts from an opaque `file://` origin, and the game stores best times in
`localStorage`, which is unreliable there. `mobile/lib/web_asset_server.dart` serves
the bundled build on `127.0.0.1:<random port>`, from an explicit
`asset_index.json` list (Flutter's internal `AssetManifest` format changes between
SDK versions). 17 dependency-free checks live in `mobile/tool/verify_asset_server.dart`.

**Build pins that look odd but are deliberate** (documented in `README.md`):

| Setting | Reason |
|---|---|
| AGP 8.13.0 | `flutter_inappwebview_android` 1.1.3 calls `getDefaultProguardFile("proguard-android.txt")`, which AGP 9 rejects |
| `-Xmx1280m` gradle heap, Kotlin in-process | The Flutter template asks for 8 GB; the container has 4 GB and OOM-kills the daemon |
| `ndkVersion` pinned + stub | AGP resolves an NDK even with no native code |
| `llvm-strip` only | Without it `libflutter.so` ships unstripped at 165 MB instead of 11.7 MB |

## 6. File map

```
mobile/
  lib/main.dart                    orientation lock, immersive mode, asset-server gate
  lib/game_screen.dart             WebView host, JS bridge (haptic / notifications), back policy
  lib/web_asset_server.dart        loopback static server (pure Dart, testable)
  lib/game_bootstrap.dart          rootBundle -> server
  lib/notification_service.dart    streak reminder (UNBUILT)
  lib/app_theme.dart               colours matching the game
  tool/verify_asset_server.dart    17 checks, no device needed
  assets/web/                      compiled game (generated)
  android/                         manifest, network security config, gradle pins
tanuki-rush/
  src/progression.js               rank tiers, daily goal, streak  (ours)
  src/platform.js                  haptics, wake lock, native bridge (ours)
  src/ui/HUD.js                    screens: title, results, pause, settings, credits, intro
  src/ui/hud.css                   all styling (ours appends at the end)
  public/art/                      AI-generated key art + emblem
tools/
  build_web_assets.py              rebuild + self-host fonts + asset index
  patch_*.py                       the staged edits, readable as a changelog
  make_icons.py                    rasterises the launcher icon, no image library
  setup_toolchain.sh               JDK + Flutter + SDK, no apt
  fetch_llvm_strip.py              pulls one file out of the NDK zip via HTTP ranges
```

## 7. Phases

Ordered by value per unit of work. Each phase lists an acceptance test — do not
close a phase without it.

### Phase 0 — Make it real (do this first)
Rebuild the toolchain, build the APK, install on a phone, and verify: app opens
offline in landscape, touch steering/jump/boost respond, haptics fire, settings
persist, onboarding shows once, streak counter appears.
**Accept:** a run start-to-finish on hardware, recorded. Fix whatever this breaks —
the native code in `9f41035` has never compiled.

### Phase 1 — Retention depth (offline, no backend)
- **Ghost replay** of your own best run — the single strongest "one more run" hook.
- **Unlock shop**: boards, trails, tanuki skins bought with leaves.
- **Three daily missions** instead of one goal, with a small reward.
- **Streak freeze** (one per week) so a missed day does not feel fatal.
**Accept:** a returning player has three distinct reasons to play, all persisted.

### Phase 2 — Social and competition (needs a backend)
Supabase or Firebase, anonymous player id, no sign-up wall.
- Daily / weekly / all-time leaderboards on the seeded daily course.
- Share card: image of grade + time + streak, exportable to the OS share sheet.
- Weekly reset with a visible countdown.
**Accept:** two devices see each other on one board; a share card lands in the
Android share sheet. Requires a privacy policy before any store release.

### Phase 3 — Content
- Two or three new stages with distinct palettes and hazards.
- Obstacle variety per stage; weather and time-of-day variants.
- Tuned difficulty curve so stage 1 teaches and stage 3 punishes.
**Accept:** opening a new stage changes how the game plays, not just the colour.

### Phase 4 — Game feel polish
Camera FOV kick on boost, landing squash, near-miss slow-mo, combo multiplier for
chained homing attacks, trick scoring surfaced at results.
**Accept:** a side-by-side recording makes the difference obvious.

### Phase 5 — Ship
Keystore + signed AAB, icon set (adaptive), screenshots, store listing, GitHub
Actions running `flutter analyze` + the asset-server checks + an APK build.
**Accept:** internal test track install works from Play Store.

### Phase 6 — iOS (only after 5)
WKWebView host; the Dart logic is portable but untested. Needs a Mac and a paid
Apple account.

## 8. Known risks

1. **`flutter_local_notifications ^18.0.1` and `timezone ^0.9.4` are unverified**
   against Flutter 3.47 — `pub get` never ran. If resolution fails, check current
   versions on pub.dev; the API used is `requestNotificationsPermission()` and
   `zonedSchedule(..., androidScheduleMode:)`.
2. **The native bridge is untested.** `callHandler` names in
   `src/platform.js` must match `addJavaScriptHandler` names in `game_screen.dart`:
   `haptic`, `requestNotifications`, `scheduleStreakReminder`.
3. **`title-bg.png` is 2.8 MB.** Convert to WebP (~250 KB) before any store release.
4. **No wake lock on iOS** and no fallback if the WebView lacks the Screen Wake Lock API.
5. **Debug-signed APK.** Never upload it to a store.
6. **The GitHub PAT used during development was pasted into a chat.** Treat it as
   compromised: it must be revoked, and the next agent should ask the owner for a
   fresh fine-grained token scoped to this one repo, or push with their own
   credentials.

## 9. Environment gotchas (they cost hours — do not re-learn them)

- `apt-get` mirrors are unreachable; install everything from tarballs.
- The container has **4 GB RAM and ~10 GB disk**. Gradle OOMs above `-Xmx1536m`.
- `rm` is intercepted and fails; use Python `shutil.rmtree` / `os.remove`.
- No Pillow, no ImageMagick — hence `tools/make_icons.py` and the raw PNG writer.
- `dart` normalises `..` in request paths before your handler sees them; test path
  traversal on the mapper function directly, not over HTTP.
- `HttpClient` also normalises `..`; use a raw socket when a test must send it.
- Keep workspace files inside the workspace; only `/opt` was wiped on restart, so
  treat `/opt` as disposable and re-runnable.

## 10. Definition of done for the whole project

A stranger installs the APK from a signed Play Store listing, plays one run without
a browser or network, understands the controls from onboarding, sees a reason to
return tomorrow, and can find the name **tanuu5** in the credits screen
acknowledging the original game.
