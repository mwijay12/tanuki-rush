## Tanuki Rush — Android preview

Try the offline downhill runner with daily missions, leaf-token rewards, unlockable cosmetic boost trails, ranks and local best times.

**Preview 1.0.1:** Changes the Android WebView setting that blocked drag steering. Hold and drag on the left half of the screen to turn, then release to center. Automated browser touch and WebView-settings checks do not replace testing on a real phone.

**Install:** Download `tanuki-rush-android-preview.apk` on an Android phone, open it, and allow installs from that source if Android asks. The APK supports arm64 and armv7 devices. `SHA256SUMS.txt` is provided to check the download.

**Important:** This is an early, debug-key-signed preview, not a production/Play Store release. It has not been verified on a physical phone. Different CI builds may have different debug signing keys, so Android may require you to uninstall the previous preview before installing another; uninstalling removes locally saved progress, and there is no built-in export. A stable private signing key and device testing are required before a public production release.

The game works offline. Progress is stored on the device and is not synced between devices. Notifications are optional and off by default. Original game by [tanuu5](https://github.com/tanuu5/tanuki-rush), MIT license; this edition adds the Android shell and gameplay/progression changes.
