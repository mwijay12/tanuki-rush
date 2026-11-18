#!/usr/bin/env python3
"""Summarise a screenshot's colours with nothing but the standard library.

Why this exists
---------------
The blue-screen investigation needs to know *what was actually on the glass*, and
the only channel that survives from CI is a check-run annotation. A PNG's byte
size already separates "flat single colour" from "a rendered scene" - a solid
1080x2400 screen compresses to ~15 KB and a game to hundreds - but it cannot say
*which* colour, and the colour is the whole diagnosis:

    #0A1A44  navy   a Flutter/Android surface (Scaffold or window background)
    #000000  black  hud.css `html, body { background: #000 }`, so the WebView is
                    being presented and only its canvas is not drawing
    #BFE3FF  pale   `Renderer.setClearColor`, the WebGL context exists but the
                    scene never rendered

The CI runners have no Pillow and adding a dependency to a smoke test is not
worth it, so this decodes the 8-bit non-interlaced PNGs that Android's
`screencap` writes using zlib and struct only.

It is a diagnostic, never a gate: anything unsupported prints a reason and exits
0, so a strange screenshot cannot turn a build red.

    python3 tools/png_summary.py boot-pass.png [--samples 6000]

Output, first line machine-readable for the shell:

    SUMMARY <file> <w>x<h> distinct=<n> centre=#RRGGBB flat=<yes|no>
      #RRGGBB 77.4%
"""
from __future__ import annotations

import struct
import sys
import zlib
from collections import Counter
from pathlib import Path

CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}
# A screenshot with this few distinct sampled colours has no content on it: one
# for the background, maybe a second for compression noise at the edges.
FLAT_THRESHOLD = 2


def decode(path: Path) -> tuple[int, int, int, bytes]:
    """Return (width, height, channels, pixels) for an 8-bit PNG."""
    data = path.read_bytes()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("not a PNG (missing signature)")

    pos = 8
    width = height = depth = colour = interlace = 0
    idat = bytearray()
    while pos + 12 <= len(data) + 4:
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        kind = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            width, height, depth, colour, _comp, _filt, interlace = struct.unpack(
                ">IIBBBBB", body
            )
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break
    if not idat:
        raise ValueError("no IDAT chunk")
    if depth != 8:
        raise ValueError(f"bit depth {depth} is not 8")
    if interlace:
        raise ValueError("interlaced PNGs are not supported")
    if colour not in CHANNELS:
        raise ValueError(f"colour type {colour} is not supported")

    channels = CHANNELS[colour]
    stride = width * channels
    raw = zlib.decompress(bytes(idat))
    if len(raw) < height * (stride + 1):
        raise ValueError("IDAT is shorter than the declared image")

    pixels = bytearray(height * stride)
    previous = bytearray(stride)
    offset = 0
    for y in range(height):
        filter_type = raw[offset]
        offset += 1
        line = bytearray(raw[offset : offset + stride])
        offset += stride

        if filter_type == 0:  # None
            pass
        elif filter_type == 2:  # Up
            # Per-byte modular add. A whole-row big-integer add looks faster but
            # is wrong: it carries between bytes, so 0xFF + 0x02 would yield 0x01
            # plus a carry into the next pixel instead of a plain 0x01.
            line = bytearray((a + b) & 0xFF for a, b in zip(line, previous))
        elif filter_type == 1:  # Sub
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif filter_type == 3:  # Average
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + previous[i]) >> 1)) & 0xFF
        elif filter_type == 4:  # Paeth
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                up = previous[i]
                up_left = previous[i - channels] if i >= channels else 0
                pa, pb, pc = abs(up - up_left), abs(left - up_left), abs(left + up - 2 * up_left)
                if pa <= pb and pa <= pc:
                    predictor = left
                elif pb <= pc:
                    predictor = up
                else:
                    predictor = up_left
                line[i] = (line[i] + predictor) & 0xFF
        else:
            raise ValueError(f"unknown filter type {filter_type} on row {y}")

        pixels[y * stride : (y + 1) * stride] = line
        previous = line

    return width, height, channels, bytes(pixels)


def rgb_at(pixels: bytes, channels: int, x: int, y: int, width: int) -> str:
    index = (y * width + x) * channels
    if channels >= 3:
        r, g, b = pixels[index], pixels[index + 1], pixels[index + 2]
    else:  # greyscale, with or without alpha
        r = g = b = pixels[index]
    return f"#{r:02X}{g:02X}{b:02X}"


def summarise(path: Path, samples: int) -> int:
    width, height, channels, pixels = decode(path)
    step_x = max(1, width // 100)
    step_y = max(1, height // 60)
    histogram: Counter[str] = Counter()
    total = 0
    for y in range(0, height, step_y):
        for x in range(0, width, step_x):
            histogram[rgb_at(pixels, channels, x, y, width)] += 1
            total += 1
            if total >= samples:
                break
        if total >= samples:
            break

    centre = rgb_at(pixels, channels, width // 2, height // 2, width)
    distinct = len(histogram)
    flat = "yes" if distinct <= FLAT_THRESHOLD else "no"
    print(f"SUMMARY {path.name} {width}x{height} distinct={distinct} centre={centre} flat={flat}")
    for colour, count in histogram.most_common(5):
        print(f"  {colour} {100.0 * count / total:.1f}%")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__.strip().splitlines()[-1])
        return 0
    path = Path(argv[1])
    samples = 6000
    if "--samples" in argv:
        try:
            samples = int(argv[argv.index("--samples") + 1])
        except (IndexError, ValueError):
            pass
    if not path.is_file():
        print(f"SUMMARY {path.name} missing distinct=0 centre=#?????? flat=unknown")
        return 0
    try:
        return summarise(path, samples)
    except Exception as error:  # noqa: BLE001 - a diagnostic must never fail a build
        print(f"SUMMARY {path.name} undecodable distinct=0 centre=#?????? flat=unknown")
        print(f"  reason: {error}")
        return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
