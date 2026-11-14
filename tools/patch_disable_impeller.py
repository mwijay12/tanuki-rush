#!/usr/bin/env python3
"""Diagnostic only: inject the Impeller opt-out into the Android manifest.

The Android startup hang (empty blue window background, no first Flutter frame)
reproduced on an API 36 emulator with the 1.0.5 APK, and the leading suspect is
Impeller/Vulkan bring-up rather than anything in this repository's Dart code.
This script produces the APK that tests that theory.

It is deliberately NOT applied to the committed manifest. Disabling Impeller
would change rendering on every device, including the ones that boot fine today,
and neither this sandbox nor a code review can verify the result; only an
emulator can. CI therefore runs it on an ephemeral checkout, builds a debug APK,
boot-tests it, and throws the tree away. The released APK always keeps Flutter's
default rasterizer.

If Flutter 3.47.9 no longer honours this key, the diagnostic build boots exactly
like the normal one and the experiment is simply inconclusive — it cannot make
things worse, which is why it is safe to run.

    python3 tools/patch_disable_impeller.py [path/to/AndroidManifest.xml]
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MANIFEST = ROOT / "mobile/android/app/src/main/AndroidManifest.xml"
KEY = "io.flutter.embedding.android.EnableImpeller"
SNIPPET = (
    "        <!-- Diagnostic build only: opt out of Impeller to test whether the\n"
    "             pre-frame startup hang is rasterizer bring-up. -->\n"
    f'        <meta-data android:name="{KEY}" android:value="false" />\n'
)


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_MANIFEST
    if not path.is_file():
        print(f"missing manifest: {path}", file=sys.stderr)
        return 1
    text = path.read_text(encoding="utf-8")
    if KEY in text:
        print(f"{path.name}: {KEY} is already present; nothing to inject")
        return 0

    anchor = "</application>"
    found = text.count(anchor)
    if found != 1:
        print(f"{path.name}: expected exactly one {anchor}, found {found}", file=sys.stderr)
        return 1

    path.write_text(text.replace(anchor, SNIPPET + "    " + anchor, 1), encoding="utf-8")
    print(f"{path.name}: injected {KEY}=false")
    for line in path.read_text(encoding="utf-8").splitlines():
        if "impeller" in line.lower():
            print("  | " + line.rstrip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
