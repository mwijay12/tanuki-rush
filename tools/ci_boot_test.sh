#!/usr/bin/env bash
# Boot smoke test (runs on a CI emulator via android-emulator-runner).
#
# Installs the x86_64 debug APK, launches it, and fails unless the app paints
# its first Flutter frame. Regression test for the 1.0.4/1.0.5 "empty blue
# screen" reports, where the app wedged before the first frame with no message.
#
# Every phase prints a marker, because "the boot test failed" is not enough:
# an emulator that never finished booting is an infrastructure problem, while
# "no first frame" on a healthy emulator is the actual bug. On failure the
# script also reports whether the native watchdog fired, which separates
# "the Flutter engine never painted" from "the process never ran at all".
#
# BOOT_TEST_APK lets the newer-API jobs point at a downloaded artifact.
set -uo pipefail

apk="${BOOT_TEST_APK:-mobile/build/app/outputs/flutter-apk/app-debug.apk}"
package='com.tanukirush.tanuki_rush'
frame_wait_seconds="${FRAME_WAIT_SECONDS:-180}"

phase() { echo "PHASE: $*"; }
fail() {
  echo "::error::BOOT TEST FAILED ($1): $2"
  exit 1
}

phase "emulator boot"
adb wait-for-device || fail emulator "adb never saw a device"
for _ in $(seq 1 60); do
  [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
  sleep 5
done
booted="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
[ "$booted" = "1" ] || fail emulator "sys.boot_completed never became 1"
sdk="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
release="$(adb shell getprop ro.build.version.release | tr -d '\r')"
echo "Emulator ready: Android $release (API $sdk)"

phase "apk"
test -f "$apk" || fail apk "missing $apk; build or download it first"
ls -lh "$apk"

phase "install"
adb logcat -c
# `sys.boot_completed` can precede a usable package manager, and a fresh emulator
# occasionally refuses the first install. Retry, and put adb's own words into the
# annotation: "failed (install)" without the reason is not actionable, and this
# phase is not the bug being hunted.
install_output=""
installed=false
for attempt in 1 2 3; do
  if install_output="$(adb install -r "$apk" 2>&1)"; then
    installed=true
    break
  fi
  echo "install attempt $attempt failed:"
  printf '%s\n' "$install_output"
  sleep 20
done
if [ "$installed" != true ]; then
  fail install "$(printf '%s' "$install_output" | tr '\n' ' ' | tr -s ' ' | tail -c 300)"
fi

phase "launch"
launch_output="$(adb shell am start -n "$package/.MainActivity" 2>&1)" || fail launch "$launch_output"
printf '%s\n' "$launch_output"
# `am start` can exit 0 while reporting a failure, which would otherwise be
# misread later as "the app started but never painted".
case "$launch_output" in
  *Error*|*Exception*) fail launch "$launch_output" ;;
esac

phase "first frame"
# The app prints [tanuki] first-frame-painted after its first frame, and
# native-watchdog lines if the Android UI thread is alive but Flutter is not.
deadline=$(( $(date +%s) + frame_wait_seconds ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if adb logcat -d | grep -q 'first-frame-painted'; then
    echo "PASSED: first Flutter frame painted on Android $release (API $sdk)."
    exit 0
  fi
  sleep 5
done

phase "diagnostics"
log="$(adb logcat -d)"
echo "--- app process ---"
adb shell ps -A 2>/dev/null | grep "$package" || echo "app process is NOT running"
echo "--- resumed activity ---"
adb shell dumpsys activity activities 2>/dev/null | grep -iE "ResumedActivity|topResumedActivity" | head -n 5 || true
# The activity is locked to sensorLandscape, so a stuck rotation or a missing
# GPU backend would also stop the first frame. Record what the device reports.
echo "--- display rotation ---"
adb shell dumpsys window displays 2>/dev/null | grep -iE "mCurrentRotation|init=|cur=" | head -n 5 || true
echo "--- graphics backend ---"
adb shell dumpsys SurfaceFlinger 2>/dev/null | head -n 15 || true
echo "--- watchdog / flutter / crash lines ---"
grep -E 'TanukiBoot|TanukiStorage|\[tanuki\]|\[gate\]|flutter|Flutter|Impeller|impeller|Vulkan|AndroidRuntime|libc|DEBUG|ANR ' <<<"$log" | tail -n 200 || true
echo "--- ANR traces ---"
adb shell ls -l /data/anr 2>/dev/null || true
adb exec-out screencap -p > boot-failure.png || true
adb logcat -d > boot-failure-logcat.txt || true

if grep -q 'native-watchdog: armed' <<<"$log" && ! grep -q 'native-watchdog: first frame painted' <<<"$log"; then
  echo "VERDICT: the activity ran and the native watchdog was armed, but Flutter never painted."
  echo "That is a Flutter engine/renderer problem on Android $release (API $sdk), not Dart startup code."
  grep -q 'native-watchdog: no first frame' <<<"$log" \
    && echo "The user-facing error screen was shown, so this is no longer a silent blue screen."
elif ! grep -q 'native-watchdog' <<<"$log"; then
  echo "VERDICT: no watchdog line at all - the process probably never started or crashed immediately."
  echo "Look for AndroidRuntime/libc lines above."
fi

tail -n 50 boot-failure-logcat.txt || true
fail "first frame" "no first Flutter frame within ${frame_wait_seconds}s on Android $release (API $sdk)"
