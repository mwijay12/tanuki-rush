#!/usr/bin/env python3
"""Generate the launcher icon (legacy PNGs + adaptive icon layers).

No third-party imaging library is available in this container, so this file
rasterises the same leaf shape the Flutter splash draws, using cubic Bézier
sampling and 4x4 supersampling, and writes PNGs directly with zlib.

Run from the repository root:  python3 tools/make_icons.py
"""
from __future__ import annotations

import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "mobile", "android", "app", "src", "main", "res")

NIGHT = (0x0A, 0x1A, 0x44)
LEAF = (0xFF, 0xC6, 0x29)
DEEP = (0x0C, 0x16, 0x33)

# Legacy square-icon densities: (folder, size in px)
LEGACY = [
    ("mipmap-mdpi", 48),
    ("mipmap-hdpi", 72),
    ("mipmap-xhdpi", 96),
    ("mipmap-xxhdpi", 144),
    ("mipmap-xxxhdpi", 192),
]
# Adaptive foreground canvas is 108dp; the safe zone is the middle 72dp.
ADAPTIVE = [
    ("mipmap-mdpi", 108),
    ("mipmap-hdpi", 162),
    ("mipmap-xhdpi", 216),
    ("mipmap-xxhdpi", 324),
    ("mipmap-xxxhdpi", 432),
]


def cubic(p0, p1, p2, p3, steps=120):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def leaf_outline():
    """The leaf silhouette from the game's icon, in 0..1 coordinates."""
    pts = cubic((0.5, 0.05), (0.95, 0.28), (0.90, 0.70), (0.5, 0.95))
    pts += cubic((0.5, 0.95), (0.10, 0.70), (0.05, 0.28), (0.5, 0.05))
    return pts


def point_in_polygon(x, y, poly):
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y):
            xint = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x < xint:
                inside = not inside
        j = i
    return inside


def dist_to_segment(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    if length_sq == 0:
        return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length_sq))
    cx, cy = ax + t * dx, ay + t * dy
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5


def blend(dst, src, alpha):
    return tuple(round(d + (s - d) * alpha) for d, s in zip(dst, src))


def render(size, *, background=None, leaf_scale=1.0, with_vein=True, inset=0.0):
    """Returns RGBA rows. `background` None means transparent."""
    poly = leaf_outline()
    vein_w = 0.030
    ss = 4  # supersampling factor per axis
    pixels = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            accum = [0.0, 0.0, 0.0, 0.0]
            for sy in range(ss):
                for sx in range(ss):
                    # map sample to icon space, then into leaf space
                    fx = (px + (sx + 0.5) / ss) / size
                    fy = (py + (sy + 0.5) / ss) / size

                    if background is None:
                        base = (0, 0, 0, 0.0)
                    else:
                        margin = inset
                        inside_bg = margin <= fx <= 1 - margin and margin <= fy <= 1 - margin
                        if not inside_bg:
                            base = (0, 0, 0, 0.0)
                        else:
                            base = (*background, 1.0)

                    # leaf coordinates
                    lx = (fx - 0.5) / leaf_scale + 0.5
                    ly = (fy - 0.5) / leaf_scale + 0.5

                    color = base
                    if 0.0 <= lx <= 1.0 and 0.0 <= ly <= 1.0 and point_in_polygon(lx, ly, poly):
                        color = (*LEAF, 1.0)
                        if with_vein and dist_to_segment(lx, ly, 0.5, 0.22, 0.5, 0.82) < vein_w:
                            color = (*blend(LEAF, DEEP, 0.55), color[3])

                    accum[0] += color[0] * color[3]
                    accum[1] += color[1] * color[3]
                    accum[2] += color[2] * color[3]
                    accum[3] += color[3]
            n = ss * ss
            a = accum[3] / n
            if a <= 0.0001:
                row += bytes((0, 0, 0, 0))
            else:
                row += bytes(
                    (
                        round(accum[0] / accum[3]),
                        round(accum[1] / accum[3]),
                        round(accum[2] / accum[3]),
                        round(a * 255),
                    )
                )
        pixels.append(bytes(row))
    return pixels


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(png)


def main():
    written = []
    for folder, size in LEGACY:
        rows = render(size, background=NIGHT, leaf_scale=0.62)
        path = os.path.join(RES, folder, "ic_launcher.png")
        write_png(path, size, rows)
        written.append(path)

    for folder, size in ADAPTIVE:
        rows = render(size, background=None, leaf_scale=0.42)
        path = os.path.join(RES, folder, "ic_launcher_foreground.png")
        write_png(path, size, rows)
        written.append(path)

    adaptive_dir = os.path.join(RES, "mipmap-anydpi-v26")
    os.makedirs(adaptive_dir, exist_ok=True)
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        with open(os.path.join(adaptive_dir, name), "w", encoding="utf-8") as fh:
            fh.write(
                '<?xml version="1.0" encoding="utf-8"?>\n'
                '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                '    <background android:drawable="@color/game_night" />\n'
                '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
                "</adaptive-icon>\n"
            )
        written.append(os.path.join(adaptive_dir, name))

    for path in written:
        print(os.path.relpath(path, ROOT))
    print(f"{len(written)} icon file(s) written")


if __name__ == "__main__":
    main()
