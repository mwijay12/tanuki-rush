#!/usr/bin/env python3
"""Rebuild the game and refresh mobile/assets/web/ so the Android app is self-contained.

Steps
  1. Build the upstream Vite project (tanuki-rush/) into dist/.
  2. Copy dist/ into mobile/assets/web/.
  3. Replace the Google Fonts <link> with self-hosted latin subsets (offline-safe).
  4. Emit asset_index.json, the asset list the in-app server serves from.

Run from the repository root:  python3 tools/build_web_assets.py
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME_SRC = os.path.join(ROOT, "tanuki-rush")
WEB_OUT = os.path.join(ROOT, "mobile", "assets", "web")

FONT_CSS_URL = (
    "https://fonts.googleapis.com/css2"
    "?family=Exo+2:ital,wght@1,800;1,900"
    "&family=M+PLUS+Rounded+1c:wght@700;800"
    "&display=swap"
)
# Only latin ranges are bundled; CJK glyphs fall back to the system font.
KEEP_SUBSETS = {"latin", "latin-ext"}
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def run(cmd: list[str], cwd: str) -> None:
    print(f"$ {' '.join(cmd)}  (in {cwd})")
    subprocess.run(cmd, cwd=cwd, check=True)


def build_game() -> None:
    run(["npm", "ci", "--no-audit", "--no-fund"], GAME_SRC)
    run(["npm", "run", "build"], GAME_SRC)


def copy_dist() -> None:
    dist = os.path.join(GAME_SRC, "dist")
    if not os.path.isdir(dist):
        sys.exit("dist/ missing — did the Vite build fail?")
    if os.path.isdir(WEB_OUT):
        shutil.rmtree(WEB_OUT)
    shutil.copytree(dist, WEB_OUT)
    print(f"copied dist/ -> {os.path.relpath(WEB_OUT, ROOT)}")


def bundle_fonts() -> None:
    css = urllib.request.urlopen(
        urllib.request.Request(FONT_CSS_URL, headers={"User-Agent": UA}), timeout=30
    ).read().decode("utf-8")

    blocks = re.findall(r"/\*\s*([\w-]+)\s*\*/\s*(@font-face\s*\{[^}]*\})", css)
    fonts_dir = os.path.join(WEB_OUT, "fonts")
    os.makedirs(fonts_dir, exist_ok=True)

    kept, seen = [], {}
    for subset, block in blocks:
        if subset not in KEEP_SUBSETS:
            continue
        match = re.search(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", block)
        if not match:
            continue
        url = match.group(1)
        name = hashlib.sha1(url.encode()).hexdigest()[:12] + ".woff2"
        if name not in seen:
            urllib.request.urlretrieve(url, os.path.join(fonts_dir, name))
            seen[name] = True
        kept.append(f"/* {subset} */\n{block.replace(url, f'./fonts/{name}')}")

    with open(os.path.join(WEB_OUT, "fonts.css"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(kept) + "\n")

    index_path = os.path.join(WEB_OUT, "index.html")
    html = open(index_path, encoding="utf-8").read()
    html = re.sub(
        r'\s*<link rel="preconnect" href="https://fonts\.[^"]*"[^>]*/\s*>',
        "",
        html,
    )
    html = re.sub(
        r'<link href="https://fonts\.googleapis\.com/css2\?[^"]*" rel="stylesheet"\s*/?>',
        '<link href="./fonts.css" rel="stylesheet" />',
        html,
    )
    open(index_path, "w", encoding="utf-8").write(html)
    print(f"self-hosted {len(seen)} font file(s), patched index.html")


def write_asset_index() -> None:
    keys = []
    for dirpath, _, files in os.walk(WEB_OUT):
        for name in files:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, os.path.join(ROOT, "mobile"))
            keys.append(rel.replace(os.sep, "/"))
    keys.sort()
    index_path = os.path.join(WEB_OUT, "asset_index.json")
    with open(index_path, "w", encoding="utf-8") as fh:
        json.dump(keys, fh, indent=1)
    print(f"asset_index.json: {len(keys)} entries")


def main() -> None:
    build_game()
    copy_dist()
    bundle_fonts()
    write_asset_index()
    total = sum(
        os.path.getsize(os.path.join(d, f))
        for d, _, fs in os.walk(WEB_OUT)
        for f in fs
    )
    print(f"done — {total / 1024:.0f} KiB in mobile/assets/web/")


if __name__ == "__main__":
    main()
