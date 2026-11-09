## Tanuki Rush — Android preview

Try the offline downhill runner with daily missions, leaf-token rewards, unlockable cosmetic boost trails, ranks and local best times.

**Preview 1.0.3:** A crash or fall now shows Game Over. Choose **REVIVE FREE** once per run to continue from the last checkpoint with your score and leaves, or **RETRY FROM START**. Collected leaves no longer absorb crashes; BOOST can still smash obstacles. No payment, ads or internet connection are needed for the revive.

The BOOST sound has been made quieter and simpler, and the music scheduler has more time to handle brief frame stalls. The earlier automatic audio recovery and **Pause → Settings → Restore Audio → Reset** remain available. Browser tests monitor music and output during a held BOOST, repeated taps and a simulated stall, but they did not reproduce the reported Pixel audio loss. **Please test on the physical phone; this is not a confirmed device fix.** Steering by holding and dragging on the left half remains included.

**Install:** Download `tanuki-rush-android-preview.apk` on an Android phone, open it, and allow installs from that source if Android asks. The APK supports arm64 and armv7 devices. `SHA256SUMS.txt` is provided to check the download.

**Important:** This is an early, debug-key-signed preview, not a production/Play Store release. Different CI builds may have different debug signing keys, so Android may require you to uninstall the previous preview before installing another; uninstalling removes locally saved progress, and there is no built-in export. A stable private signing key and device testing are required before a public production release.

The game works offline. Progress is stored on the device and is not synced between devices. Notifications are optional and off by default. Original game by [tanuu5](https://github.com/tanuu5/tanuki-rush), MIT license; this edition adds the Android shell and gameplay/progression changes.
