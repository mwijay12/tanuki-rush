#!/usr/bin/env bash
# Boot smoke test (runs on a CI emulator via android-emulator-runner).
#
# Installs the x86_64 debug APK, launches it, and fails unless the app paints
# its first Flutter frame. Regression test for the 1.0.4 "empty blue screen"
# report, where the app wedged before the first frame with no message.
set -euo pipefail

apk='mobile/build/app/outputs/flutter-apk/app-debug.apk'
test -f "$apk" || { echo "missing $apk; build it first"; exit 1; }

adb logcat -c
adb install "$apk"
adb shell am start -n com.tanukirush.tanuki_rush/.MainActivity

# The app prints [tanuki] first-frame-painted after its first frame.
for _ in $(seq 1 36); do
  if adb logcat -d | grep -q 'first-frame-painted'; then
    echo 'Boot smoke test passed: first Flutter frame painted.'
    exit 0
  fi
  sleep 5
done

echo '::error::BOOT SMOKE TEST FAILED: no first frame within 3 minutes.'
adb exec-out screencap -p > boot-failure.png || true
adb logcat -d > boot-failure-logcat.txt || true
tail -n 50 boot-failure-logcat.txt || true
exit 1
