#!/usr/bin/env python3
"""Fetch only `llvm-objcopy` out of the Android NDK zip, without downloading it.

The NDK zip is ~690 MB but the build only needs `llvm-strip` (a symlink to
llvm-objcopy) so AGP can strip libflutter.so. This reads the zip's central
directory over HTTP range requests and downloads just that one entry.

Usage: python3 tools/fetch_llvm_strip.py [--url URL] [--dest DIR]
"""
from __future__ import annotations

import argparse
import io
import os
import shutil
import sys
import urllib.request
import zipfile

DEFAULT_URL = "https://dl.google.com/android/repository/android-ndk-r27-linux.zip"
MEMBER_SUFFIX = "/bin/llvm-objcopy"


class HttpRangeFile(io.RawIOBase):
    """A read-only, seekable file-like view of a remote HTTP resource."""

    def __init__(self, url: str) -> None:
        self.url = url
        request = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(request, timeout=60) as response:
            self.size = int(response.headers["Content-Length"])
        self._pos = 0

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self._pos

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            self._pos = offset
        elif whence == io.SEEK_CUR:
            self._pos += offset
        else:
            self._pos = self.size + offset
        return self._pos

    def readinto(self, buffer) -> int:
        # io.BufferedReader goes through readinto(), not read().
        data = self.read(len(buffer))
        buffer[: len(data)] = data
        return len(data)

    def read(self, size: int = -1) -> bytes:
        if size is None or size < 0:
            size = self.size - self._pos
        if size <= 0 or self._pos >= self.size:
            return b""
        end = min(self._pos + size, self.size) - 1
        request = urllib.request.Request(
            self.url, headers={"Range": f"bytes={self._pos}-{end}"}
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
        self._pos += len(data)
        return data


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--dest", default="/tmp/ndk-tools")
    args = parser.parse_args()

    print(f"opening {args.url} via range requests")
    remote = io.BufferedReader(HttpRangeFile(args.url), buffer_size=1 << 20)
    archive = zipfile.ZipFile(remote)

    matches = [n for n in archive.namelist() if n.endswith(MEMBER_SUFFIX)]
    if not matches:
        print("llvm-objcopy not found in archive", file=sys.stderr)
        return 1
    member = sorted(matches, key=len)[0]
    info = archive.getinfo(member)
    print(f"member: {member} ({info.file_size / 1e6:.1f} MB uncompressed)")

    os.makedirs(args.dest, exist_ok=True)
    target = os.path.join(args.dest, "llvm-objcopy")
    with archive.open(member) as src, open(target, "wb") as dst:
        shutil.copyfileobj(src, dst, length=1 << 20)
    os.chmod(target, 0o755)

    # llvm-strip is a symlink to llvm-objcopy inside the NDK.
    link = os.path.join(args.dest, "llvm-strip")
    if os.path.lexists(link):
        os.remove(link)
    os.symlink("llvm-objcopy", link)

    print(f"wrote {target} ({os.path.getsize(target) / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
