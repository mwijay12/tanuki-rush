# Handoff — Tanuki Rush Mobile Edition

Updated 2026-11-08. For user-facing build and release instructions, see [README](../README.md).

## Current scope

- Original Three.js game by tanuu5, MIT. This edition supplies a Flutter Android shell and adds English UI, offline daily missions, local token rewards, cosmetic boost trails, ranks, streaks and settings. Preserve the original credits and licenses.
- Browser preview, tests and production bundle use `tanuki-rush/`; run `python3 tools/build_web_assets.py` after game edits to refresh `mobile/assets/web/`.
- No online database or leaderboard is connected. [DATABASE.md](DATABASE.md) recommends Supabase for a future opt-in online phase and outlines required security and privacy work.
- Local saves are scoped to the full WebView origin. `gameStoragePort` is fixed at `43853`; do not change it after shipping. The former random-port builds cannot automatically migrate old saves. A port conflict fails closed rather than falling back to another origin.
- Android reminders are opt-in and off by default. `flutter_local_notifications` requires Java desugaring in the app Gradle file.

## Verification in this workspace

- `npm test` covers crash and invulnerability semantics, audio scheduling and recovery/lifecycle races, plus deterministic missions, once-per-day bonuses, purchases, save migration, streak dates and rank thresholds.
- `npm run test:touch` simulates actual touch/pointer events in portrait and landscape on the bundled game; it verifies movement, multitouch boost, jump, cancellation, pause/resume and no page scrolling. `npm run test:gameover` tests car/truck crashes, falls, the one optional revive, score/pickup integrity, keyboard activation and fresh-run retry in both orientations. Browser tests are not a physical-device playthrough. An older bot completed the course before these crash-rule changes; it does not verify the current difficulty.
- A Pixel 8 Pro user confirmed the 1.0.1 preview fixes steering, but later reported sound cutting out when BOOST is pressed/held, then returning. The exact cause is unconfirmed. In a headless browser probe, stage music continued during BOOST but the old continuous effect was louder than the music (average bus RMS about 0.162 vs 0.102); this does not explain or reproduce a complete device audio loss. Preview 1.0.3 simplifies and lowers the BOOST effect, extends music lookahead, and ensures a crash/restart stops the BOOST loop. `npm run test:audio` measures music, BOOST and post-limiter output together during held BOOST (including live rendered gameplay), repeated taps and a 220 ms simulated main-thread stall, as well as suspension, closure, mute, pause and reset. The earlier automatic recovery and manual Pause → Settings → Restore Audio → Reset remain. Physical-device confirmation is still needed.
- In flutter_inappwebview_android 1.1.3, the `disableHorizontalScroll` and `disableVerticalScroll` flags intercept or rewrite `ACTION_MOVE`. Both must remain false in `mobile/lib/game_webview_settings.dart`; CSS disables scrolling and native overscroll remains off. A Flutter settings test guards those flags, but a browser test cannot reproduce native event interception.
- This sandbox does not have Flutter, Java or Android SDK installed and cannot reach their normal download hosts. The merged 1.0.2 build passed [GitHub Actions](https://github.com/mwijay12/tanuki-rush/actions/runs/42569938154). Check the [Releases page](https://github.com/mwijay12/tanuki-rush/releases) and the corresponding CI run for a newer debug-signed preview; 1.0.3 needs its own CI and physical-device testing.
- The root GitHub Actions workflow builds an artifact and can publish a debug-signed pre-release when the pushed commit message contains `[release-preview]`. A preview is **not** production signing. Each runner may generate a different debug key, and uninstalling a previous build to change keys deletes progress.

## Next steps

1. Confirm the new GitHub Actions run is green, then install its APK on physical phones. On the Pixel, repeatedly tap and hold BOOST during normal play, listening for both music and JUMP/BOOST, and report whether sound drops out. If it stops, try automatic recovery and Pause → Settings → Restore Audio → Reset. Crash/fall, test the one free revive and the no-revive second failure, retry from the start, and complete a run. Also check both orientations, touch controls, haptics and optional notifications.
2. Close and reopen the app and confirm best time, missions, purchased trail, settings and onboarding persist. Also test airplane mode and an app update using the same signing key.
3. Obtain and securely back up a long-lived release keystore; configure signing via secrets before production/Play Store. Never commit or paste credentials.
4. Only then add the opt-in Supabase leaderboard; test access policies with at least two players and document the privacy policy. A client-reported score is not cheat-proof.
