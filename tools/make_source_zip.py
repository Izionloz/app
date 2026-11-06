#!/usr/bin/env python3
"""Rebuilds mgux-hud-map-source.zip from the repository tree (forward-slash paths, fixed order and dates)."""
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARTS = ['README.md', 'LICENSE', 'apps', 'designer', 'eva', 'native', 'release', 'tools']


def files():
    for part in PARTS:
        full = os.path.join(ROOT, part)
        if os.path.isfile(full):
            yield part
            continue
        for d, dirs, names in os.walk(full):
            dirs.sort()
            for n in sorted(names):
                yield os.path.relpath(os.path.join(d, n), ROOT).replace(os.sep, '/')


with zipfile.ZipFile(os.path.join(ROOT, 'mgux-hud-map-source.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
    for rel in files():
        info = zipfile.ZipInfo(rel, (2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        with open(os.path.join(ROOT, rel), 'rb') as f:
            z.writestr(info, f.read())
