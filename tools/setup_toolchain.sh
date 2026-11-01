#!/usr/bin/env bash
# Installs JDK 17 + Flutter stable + Android SDK (cmdline-tools) without apt
# (apt mirrors are unreachable in this container), so we can build a release APK.
set -euo pipefail

SDK_ROOT=/opt/android-sdk
FLUTTER_ROOT=/opt/flutter
JDK_ROOT=/opt/jdk17

log() { echo "[setup] $*"; }

# ---------------------------------------------------------------- 1. JDK 17
if [ ! -x "$JDK_ROOT/bin/java" ]; then
  log "downloading Temurin JDK 17"
  curl -fL --retry 3 -o /tmp/jdk.tar.gz \
    "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse"
  mkdir -p /opt/jdk-tmp
  tar -xzf /tmp/jdk.tar.gz -C /opt/jdk-tmp
  mv /opt/jdk-tmp/* "$JDK_ROOT"
  rm -rf /opt/jdk-tmp /tmp/jdk.tar.gz
fi
export JAVA_HOME="$JDK_ROOT"
export PATH="$JAVA_HOME/bin:$PATH"
log "java: $("$JAVA_HOME/bin/java" -version 2>&1 | head -1)"

# ------------------------------------------------------------- 2. Flutter
if [ ! -x "$FLUTTER_ROOT/bin/flutter" ]; then
  log "resolving latest stable Flutter release"
  META=$(curl -fsSL https://storage.googleapis.com/flutter_infra_release/releases/releases_linux.json)
  ARCHIVE=$(printf '%s' "$META" | python3 -c '
import sys, json
d = json.load(sys.stdin)
stable = d["current_release"]["stable"]
for r in d["releases"]:
    if r["hash"] == stable:
        print(d["base_url"] + "/" + r["archive"])
        break
')
  log "downloading $ARCHIVE"
  curl -fL --retry 3 -o /tmp/flutter.tar.xz "$ARCHIVE"
  log "extracting"
  mkdir -p /opt
  tar -xf /tmp/flutter.tar.xz -C /opt
  rm -f /tmp/flutter.tar.xz
fi
export PATH="$FLUTTER_ROOT/bin:$PATH"
git config --global --add safe.directory "$FLUTTER_ROOT" || true
log "flutter: $(flutter --version 2>/dev/null | head -1)"

# -------------------------------------------------------- 3. Android SDK
if [ ! -d "$SDK_ROOT/cmdline-tools/latest" ]; then
  log "resolving Android cmdline-tools"
  CLT=$(curl -fsSL https://developer.android.com/studio \
        | grep -oE 'commandlinetools-linux-[0-9]+_latest\.zip' \
        | head -1)
  [ -n "$CLT" ] || { log "FATAL: could not resolve cmdline-tools filename"; exit 1; }
  log "downloading $CLT"
  curl -fL --retry 3 -o /tmp/clt.zip "https://dl.google.com/android/repository/$CLT"
  mkdir -p "$SDK_ROOT/cmdline-tools"
  unzip -q /tmp/clt.zip -d "$SDK_ROOT/cmdline-tools"
  mv "$SDK_ROOT/cmdline-tools/cmdline-tools" "$SDK_ROOT/cmdline-tools/latest"
  rm -f /tmp/clt.zip
fi

export ANDROID_HOME="$SDK_ROOT"
export ANDROID_SDK_ROOT="$SDK_ROOT"
SDKMANAGER="$SDK_ROOT/cmdline-tools/latest/bin/sdkmanager"

log "accepting licenses"
yes | "$SDKMANAGER" --sdk_root="$SDK_ROOT" --licenses >/dev/null 2>&1 || true

log "installing platform-tools + platforms + build-tools"
yes | "$SDKMANAGER" --sdk_root="$SDK_ROOT" \
  "platform-tools" \
  "platforms;android-35" \
  "platforms;android-36" \
  "build-tools;35.0.0" \
  "build-tools;36.0.0" 2>&1 | tail -5

# ------------------------------------------------------------- 4. Config
flutter config --android-sdk "$SDK_ROOT" >/dev/null 2>&1 || true
flutter config --no-analytics >/dev/null 2>&1 || true
log "flutter doctor:"
flutter doctor -v 2>&1 | sed -n '1,40p'

log "done"
