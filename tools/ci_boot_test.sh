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
for _ in $(seq 1 90); do
  case "$(adb shell service check package 2>/dev/null)" in *found*) break ;; esac
  sleep 5
done
case "$(adb shell service check package 2>/dev/null)" in
  *found*) t_pkg="$(( $(date +%s) - t_start ))"; echo "Package service is up after ${t_pkg}s." ;;
  *) fail emulator "the package service never came up, so adb install cannot work" ;;
esac

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
    # as a visible game: on the Pixel 8 Pro Flutter paints in ~1.1 s, the WebView
    # loads and the game runs, yet the screen stays a flat navy because the
    # platform view stops being presented. This check cannot gate on that (an
    # emulator has no real GPU, so the WebGL canvas may legitimately stay empty),
    # but a flat single-colour PNG compresses to a few kilobytes while a rendered
    # screen needs hundreds, so the byte count is a free, dependency-less signal.
    sleep 15
    adb exec-out screencap -p > boot-pass.png 2>/dev/null || true
    if [ -s boot-pass.png ]; then
      png_bytes="$(wc -c < boot-pass.png)"
      # Which colour, not merely whether it is flat: #0A1A44 is a Flutter or
      # Android surface, #000000 is the web page's own background with a dead
      # canvas, #BFE3FF is the WebGL clear colour. Decoded with the standard
      # library only (tools/png_summary.py), because a smoke test should not need
      # Pillow and it must never be able to fail the build.
      colour="$(python3 tools/png_summary.py boot-pass.png 2>/dev/null | head -n 1)"
      [ -n "$colour" ] || colour="colour summary unavailable"
      echo "boot-pass.png: ${png_bytes} bytes"
      python3 tools/png_summary.py boot-pass.png 2>/dev/null || true
      if [ "$png_bytes" -lt 51200 ]; then
        echo "::notice::first frame painted but 15s later the screen is a single flat colour (${png_bytes} byte PNG); ${colour}"
      else
        echo "::notice::first frame painted and 15s later the screen had real content (${png_bytes} byte PNG); ${colour}"
      fi
    fi
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
if [ -s boot-failure.png ]; then
  fail_png_bytes="$(wc -c < boot-failure.png)"
  fail_colour="$(python3 tools/png_summary.py boot-failure.png 2>/dev/null | head -n 1)"
  [ -n "$fail_colour" ] || fail_colour="colour summary unavailable"
  echo "boot-failure.png: ${fail_png_bytes} bytes"
  python3 tools/png_summary.py boot-failure.png 2>/dev/null || true
  if [ "$fail_png_bytes" -lt 51200 ]; then
    echo "::notice::boot-failure.png is a flat single-colour screen (${fail_png_bytes} bytes); ${fail_colour}"
  else
    echo "::notice::boot-failure.png had content, so this is not an empty window background (${fail_png_bytes} bytes); ${fail_colour}"
  fi
fi

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
echo "VERDICT: $verdict ($proc)"
echo "READINESS: boot=${t_boot}s package=${t_pkg}s bootanim=${t_anim}s"

tail -n 50 boot-failure-logcat.txt || true
fail "first frame" "no first Flutter frame in ${frame_wait_seconds}s on Android $release (API $sdk); $proc; emulator readiness boot=${t_boot}s package=${t_pkg}s bootanim=${t_anim}s; $verdict"
