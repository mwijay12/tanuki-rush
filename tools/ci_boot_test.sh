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

# Describe a screenshot, with the decoder as the authority on flatness.
#
# The byte-count heuristic this replaces was wrong, and run 44044845761 proved it
# inside a single annotation: "a flat single-colour screen (15770 bytes)" followed
# by "640x320 distinct=92 centre=#EEEDF4 flat=no". A threshold cannot survive a
# change of resolution - every leg in that run, passing and failing alike, made a
# 14-17 KB PNG at 640x320 holding 83 to 124 distinct colours. Size is therefore
# only a fallback for images the decoder cannot read, and the claim in the notice
# always comes from the pixels. This repository's own 72x72 launcher icon is 597
# bytes and holds 21 colours, which is the whole argument in one file.
describe_screen() {
  SCREEN_BYTES=0
  SCREEN_SUMMARY="no screenshot was captured"
  SCREEN_KIND="an unknown screen"
  [ -s "$1" ] || return 0
  SCREEN_BYTES="$(wc -c < "$1")"
  SCREEN_SUMMARY="$(python3 tools/png_summary.py "$1" 2>/dev/null | head -n 1)"
  echo "$1: ${SCREEN_BYTES} bytes"
  python3 tools/png_summary.py "$1" 2>/dev/null || true
  case "$SCREEN_SUMMARY" in
    *flat=yes*) SCREEN_KIND="a flat single-colour screen" ;;
    *flat=no*) SCREEN_KIND="a screen with real content" ;;
    *)
      SCREEN_SUMMARY="colour undecodable"
      if [ "$SCREEN_BYTES" -lt 51200 ]; then
        SCREEN_KIND="probably a flat screen (small PNG, colour undecodable)"
      else
        SCREEN_KIND="probably a rendered screen (large PNG, colour undecodable)"
      fi
      ;;
  esac
}

# The page now reports its own boot stage once a second, which answers the one
# question a screenshot cannot: was the page alive? A stage line present means
# JavaScript was still running, and "ready" means the whole boot path finished.
page_boot_report() {
  local last
  last="$(grep -o '\[tanuki\] page-boot: .*' <<<"$1" | tail -n 1)"
  if [ -z "$last" ]; then
    echo "no page-boot line at all, so the page never published a stage (old bundle, or JavaScript never ran)"
    return 0
  fi
  echo "${last#*page-boot: }"
}

phase "emulator boot"
# Readiness timings are recorded because "no first frame in 180s" means something
# different on an emulator that needed 90s to reach a usable package manager than
# on one that was ready in 15s. Without them a starved runner is indistinguishable
# from a hung app, which is exactly the ambiguity run 43591614157 left behind.
t_start="$(date +%s)"
adb wait-for-device || fail emulator "adb never saw a device"
for _ in $(seq 1 60); do
  [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
  sleep 5
done
booted="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
[ "$booted" = "1" ] || fail emulator "sys.boot_completed never became 1 after 300s"
t_boot="$(( $(date +%s) - t_start ))"

# sys.boot_completed=1 comes BEFORE the package manager is reachable. Run
# 43547900681 proved it: a cold API 34 emulator answered
# "adb: failed to install ...: cmd: Can't find service: package" a full minute
# after reporting boot complete, and three 20 s retries were not enough. The old
# script ran `adb install` under `set -e` with no annotation at all, which is
# exactly how the API 37 legs of runs 42977875935 and 43540123437 died - they
# were never evidence of a missing Android 17 image. Wait for the service itself.
# `service check package` is NOT a sufficient probe, and run 44041887463 proved
# it: this script waited for the service to report "found" and `adb install` then
# failed anyway with "cmd: Can't find service: package". Registration and
# answering calls are different moments. Probe the code path the install itself
# uses, so the wait ends only when `cmd package` really replies.
for _ in $(seq 1 90); do
  if adb shell cmd package list packages -3 >/dev/null 2>&1; then break; fi
  sleep 5
done
if adb shell cmd package list packages -3 >/dev/null 2>&1; then
  t_pkg="$(( $(date +%s) - t_start ))"
  echo "cmd package answers after ${t_pkg}s (service check: $(adb shell service check package 2>/dev/null | tr -d '\r'))"
else
  fail emulator "cmd package never answered after 450s, so adb install cannot work"
fi

# Boot animation still running means first-boot dexopt is in progress and the
# first frame would be slow for reasons that have nothing to do with the app.
for _ in $(seq 1 60); do
  [ "$(adb shell getprop init.svc.bootanim 2>/dev/null | tr -d '\r')" = "stopped" ] && break
  sleep 5
done
t_anim="$(( $(date +%s) - t_start ))"
echo "bootanim: $(adb shell getprop init.svc.bootanim 2>/dev/null | tr -d '\r')"
echo "Readiness: boot_completed=${t_boot}s package_service=${t_pkg}s bootanim_done=${t_anim}s"

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
    # The 2026-11-17 field report proved that a first frame is not the same thing
    # as a visible game: on the Pixel 8 Pro Flutter painted in 1.1 s and the
    # process stayed healthy, yet the screen showed one flat navy colour. This
    # check cannot gate on a rendered game (an emulator has no real GPU, so the
    # WebGL canvas may legitimately stay empty), so it reports what was actually
    # on the glass and lets the annotation carry the evidence.
    #
    # Colour is the point, not flatness alone: #0A1A44 is a Flutter or Android
    # surface, #000000 is the web page's own background under a canvas that is
    # not drawing, #BFE3FF is the WebGL clear colour, and #FF4FD8 is the loading
    # screen's boot-stage line, which only exists while the page is alive.
    sleep 15
    adb exec-out screencap -p > boot-pass.png 2>/dev/null || true
    describe_screen boot-pass.png
    boot_log="$(adb logcat -d 2>/dev/null || true)"
    echo "--- page boot stages ---"
    grep -o '\[tanuki\] page-boot: .*' <<<"$boot_log" | tail -n 12 || true
    echo "::notice::first frame painted and 15s later the emulator showed ${SCREEN_KIND} (${SCREEN_BYTES} bytes); ${SCREEN_SUMMARY}"
    echo "::notice::last boot stage the page reported: $(page_boot_report "$boot_log")"
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
describe_screen boot-failure.png
echo "::notice::at failure the emulator showed ${SCREEN_KIND} (${SCREEN_BYTES} bytes); ${SCREEN_SUMMARY}"
echo "::notice::last boot stage the page reported: $(page_boot_report "$log")"

# The verdict has to travel inside the ::error:: annotation: Actions log and
# artifact storage is unreachable from some sandboxes, while check-run
# annotations are readable through api.github.com. Everything echoed above is
# for a human reading the run in a browser; this is for the next agent.
# The heartbeat is the part that actually settles the argument. "Armed but never
# fired" alone is ambiguous: it happens both when the Android UI thread is blocked
# inside engine/plugin init (no Dart, dead back button - the real field bug) and
# when the runner is too starved to schedule anything. A heartbeat every 5s while
# waiting separates them, so count them and quote the last one.
beats="$(grep -c 'native-watchdog: heartbeat' <<<"$log" || true)"
beats="${beats:-0}"
last_beat="$(grep 'native-watchdog: heartbeat' <<<"$log" | tail -n 1 | sed 's/^.*native-watchdog: //' || true)"
if grep -q 'native-watchdog: no first frame' <<<"$log"; then
  verdict="watchdog fired - activity and Android UI thread alive, Flutter never painted ($beats heartbeats)"
elif grep -q 'native-watchdog: armed' <<<"$log" && [ "$beats" -gt 0 ]; then
  verdict="watchdog armed, heartbeat kept beating $beats times (last: ${last_beat:-none}) - UI thread ALIVE, engine never painted"
elif grep -q 'native-watchdog: armed' <<<"$log"; then
  verdict="watchdog armed, NO heartbeat at all - UI thread STOPPED running after onCreate (blocked, not merely slow)"
elif grep -q 'native-watchdog' <<<"$log"; then
  verdict="watchdog ran but found no Flutter engine to watch"
else
  verdict="no watchdog line - process never started or died before onCreate"
fi
if adb shell ps -A 2>/dev/null | grep -q "$package"; then
  proc="process up"
else
  proc="process NOT running"
fi
# Readiness qualifies the verdict instead of merely accompanying it. Run
# 44044845761 asserted "UI thread STOPPED running after onCreate (blocked, not
# merely slow)" on an emulator whose boot animation was still running after 414 s
# and whose screenshot showed the pale grey of a system surface, not the app.
# Claiming a blocked main thread on a machine that never became healthy is the
# same over-confident reading that already produced two dead ends here.
if [ "${t_anim:-0}" -gt 120 ] || [ "${t_pkg:-0}" -gt 120 ]; then
  verdict="${verdict}; UNRELIABLE - the emulator never became healthy (readiness boot=${t_boot}s package=${t_pkg}s bootanim=${t_anim}s), so this sample says nothing about the app"
fi
echo "VERDICT: $verdict ($proc)"
echo "READINESS: boot=${t_boot}s package=${t_pkg}s bootanim=${t_anim}s"

tail -n 50 boot-failure-logcat.txt || true
fail "first frame" "no first Flutter frame in ${frame_wait_seconds}s on Android $release (API $sdk); $proc; emulator readiness boot=${t_boot}s package=${t_pkg}s bootanim=${t_anim}s; $verdict"
