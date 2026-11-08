# Handoff — Tanuki Rush Mobile Edition

Updated 2026-11-08. For user-facing build and release instructions, see [README](../README.md).

## Current scope

- Original Three.js game by tanuu5, MIT. This edition supplies a Flutter Android shell and adds English UI, offline daily missions, local token rewards, cosmetic boost trails, ranks, streaks and settings. Preserve the original credits and licenses.
- Browser preview, tests and production bundle use `tanuki-rush/`; run `python3 tools/build_web_assets.py` after game edits to refresh `mobile/assets/web/`.
- No online database or leaderboard is connected. [DATABASE.md](DATABASE.md) recommends Supabase for a future opt-in online phase and outlines required security and privacy work.
- Local saves are scoped to the full WebView origin. `gameStoragePort` is fixed at `43853`; do not change it after shipping. The former random-port builds cannot automatically migrate old saves. A port conflict fails closed rather than falling back to another origin.
- Android reminders are opt-in and off by default. `flutter_local_notifications` requires Java desugaring in the app Gradle file.

## Verification in this workspace

- `npm test` covers deterministic missions, once-per-day bonuses, purchases, save migration, streak dates and rank thresholds.
- Headless Chromium/WebGL smoke tests exercised the title, tutorial, landscape layout, shop, movement, pause/resume and simulated finish/reward flow. A bot also completed the entire course in approximately 109 simulated seconds, without changing the save. This is not a physical-device playthrough.
- This sandbox does not have Flutter, Java or Android SDK installed and cannot reach their normal download hosts. Flutter analysis, Dart server checks and the Android APK must be verified by GitHub Actions or on a machine with the toolchain. No physical Android device has been tested here.
- The root GitHub Actions workflow builds an artifact and can publish a debug-signed pre-release when the pushed commit message contains `[release-preview]`. A preview is **not** production signing. Each runner may generate a different debug key, and uninstalling a previous build to change keys deletes progress.

## Next steps

1. Confirm the GitHub Actions run is green, then install its APK on physical phones. Check landscape, touch steering/jump/boost, haptics, optional notifications and a full run.
2. Close and reopen the app and confirm best time, missions, purchased trail, settings and onboarding persist. Also test airplane mode and an app update using the same signing key.
3. Obtain and securely back up a long-lived release keystore; configure signing via secrets before production/Play Store. Never commit or paste credentials.
4. Only then add the opt-in Supabase leaderboard; test access policies with at least two players and document the privacy policy. A client-reported score is not cheat-proof.
