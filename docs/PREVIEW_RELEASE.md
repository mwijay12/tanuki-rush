## Tanuki Rush — Android preview

Try the offline downhill runner with daily missions, leaf-token rewards, unlockable cosmetic boost trails, ranks and local best times.

**Preview 1.0.4:** Android progress and settings now use a private offline SQLite database. Open **Settings → Device storage → Details** for native storage status. An in-place update from the same fixed-origin build and signing key migrates the old save once; startup stops rather than silently replacing data if the save cannot be opened. The Three.js game still runs in a WebView, and there is no Supabase connection or cloud sync.

A crash or fall shows Game Over. Choose **REVIVE FREE** once per run to continue from the last checkpoint with your score and leaves, or **RETRY FROM START**. Collected leaves no longer absorb crashes; BOOST can still smash obstacles. No payment, ads or internet connection are needed for the revive.

The BOOST sound has been made quieter and simpler, and the music scheduler has more time to handle brief frame stalls. The earlier automatic audio recovery and **Pause → Settings → Restore Audio → Reset** remain available. Browser tests monitor music and output during a held BOOST, repeated taps and a simulated stall, but they did not reproduce the reported Pixel audio loss. **Please test on the physical phone; this is not a confirmed device fix.** Steering by holding and dragging on the left half remains included.

**Install:** Download `tanuki-rush-android-preview.apk` on an Android phone, open it, and allow installs from that source if Android asks. The APK supports arm64 and armv7 devices. `SHA256SUMS.txt` is provided to check the download.

**Important:** This is an early, debug-key-signed preview, not a production/Play Store release. Different CI builds may have different debug signing keys. If Android requires you to uninstall the old preview first, its saved progress may be erased and the migration cannot recover it. There is no built-in export: **do not uninstall a build containing progress you need to keep**. SQLite migration and persistence still need testing on a physical phone with a compatible in-place update. A stable private signing key is required before production.

The game works offline. Progress is stored on the device and is not synced between devices. Notifications are optional and off by default. Original game by [tanuu5](https://github.com/tanuu5/tanuki-rush), MIT license; this edition adds the Android shell and gameplay/progression changes.
