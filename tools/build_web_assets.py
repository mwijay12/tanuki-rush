#!/usr/bin/env python3
"""Build the game and refresh the self-contained Flutter web asset bundle.

The font subsets and license notices are versioned in tanuki-rush/public/, so
this script does not fetch fonts from a third party. npm ci needs registry access
unless the dependencies are already cached. Run from any directory:

    python3 tools/build_web_assets.py
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GAME_SRC = ROOT / "tanuki-rush"
WEB_OUT = ROOT / "mobile" / "assets" / "web"


def main() -> None:
    for cmd in (["npm", "ci", "--no-audit", "--no-fund"], ["npm", "run", "build"]):
        print(f"$ {' '.join(cmd)}  (in {GAME_SRC})", flush=True)
        subprocess.run(cmd, cwd=GAME_SRC, check=True)

    dist = GAME_SRC / "dist"
    if not dist.is_dir():
        raise SystemExit("Vite did not produce dist/")
    if WEB_OUT.exists():
        shutil.rmtree(WEB_OUT)
    shutil.copytree(dist, WEB_OUT)

    html = (WEB_OUT / "index.html").read_text(encoding="utf-8")
    css = (WEB_OUT / "fonts.css").read_text(encoding="utf-8")
    if 'href="./fonts.css"' not in html or "fonts.googleapis.com" in html or "fonts.gstatic.com" in css:
        raise SystemExit("The build must reference bundled fonts, not Google Fonts")
    font_paths = re.findall(r"url\((?:['\"])?(\./fonts/[^)'\"]+)", css)
    if not font_paths or any(not (WEB_OUT / path).is_file() for path in font_paths):
        raise SystemExit("One or more bundled font files are missing")
    for license_name in ("LICENSE-tanuki-rush.txt", "LICENSE-three.txt", "fonts/OFL-Exo2.txt", "fonts/OFL-MPlusRounded1c.txt"):
        if not (WEB_OUT / license_name).is_file():
            raise SystemExit(f"Missing license notice: {license_name}")

    # The index itself is read from rootBundle by Dart; it need not serve itself.
    keys = sorted(path.relative_to(ROOT / "mobile").as_posix() for path in WEB_OUT.rglob("*") if path.is_file())
    (WEB_OUT / "asset_index.json").write_text(json.dumps(keys, indent=1) + "\n", encoding="utf-8")
    total = sum(path.stat().st_size for path in WEB_OUT.rglob("*") if path.is_file())
    print(f"Bundled {len(keys)} assets ({total / 1024:.0f} KiB) in {WEB_OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
