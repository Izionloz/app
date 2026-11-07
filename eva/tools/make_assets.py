#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Bakes the EVA cluster app's font atlases and the pilot picture into eva/app/hud/ (run once, outputs are committed so
the release build is reproducible):

    python3 eva/tools/make_assets.py --kit <bimmer-lab/apps checkout> --pilot <pilot.webp>

Fonts are baked with bimmer-lab's own tools/bake_fonts.py (Barlow Condensed, SIL OFL 1.1). The pilot picture is cut to the
cluster's box, its left edge faded to black, and stored as raw RGBA (base64 in JSON: the car has no image decoder)."""
import argparse, base64, json, os, sys

ap = argparse.ArgumentParser()
ap.add_argument('--kit', required=True)
ap.add_argument('--pilot')
a = ap.parse_args()
sys.path.insert(0, os.path.join(a.kit, 'tools'))
import bake_fonts as bf          # noqa: E402
from PIL import Image            # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'hud')
U, D, L = bf.UPPER, bf.DIGITS, bf.LOWER
FONTS = [
    ('e_title', 'BarlowCondensed-Bold.ttf', 46, U + ' '),
    ('e_sub', 'BarlowCondensed-SemiBold.ttf', 18, U + ' /'),
    ('e_clock', 'BarlowCondensed-Bold.ttf', 60, D + ':-'),
    ('e_label', 'BarlowCondensed-Bold.ttf', 30, U + ' '),
    ('e_tick', 'BarlowCondensed-SemiBold.ttf', 24, U + D + ' '),
    ('e_rpm', 'BarlowCondensed-Bold.ttf', 92, D + '-'),
    ('e_unit', 'BarlowCondensed-SemiBold.ttf', 30, L + U + '/° '),
    ('e_speed', 'BarlowCondensed-Bold.ttf', 230, D + '-'),
    ('e_unitbig', 'BarlowCondensed-Bold.ttf', 58, L + '/'),
    ('e_gear', 'BarlowCondensed-Bold.ttf', 150, 'PRNDSM' + D + '-'),
    ('e_mono', 'BarlowCondensed-SemiBold.ttf', 24, U + D + ' .:-'),
    ('e_val', 'BarlowCondensed-Bold.ttf', 50, D + '.+-'),
    ('e_tyre', 'BarlowCondensed-Bold.ttf', 28, U + L + D + ' .-'),
    # the EVA HUD on the windshield (800x480, the window the driver sees is about 485x278)
    ('w_title', 'BarlowCondensed-Bold.ttf', 26, U + ' '),
    ('w_small', 'BarlowCondensed-SemiBold.ttf', 12, U + D + ' :.-/'),
    ('w_mode', 'BarlowCondensed-Bold.ttf', 20, U + ' :'),
    ('w_label', 'BarlowCondensed-Bold.ttf', 20, U + ' '),
    ('w_rpm', 'BarlowCondensed-Bold.ttf', 24, D + '-'),
    ('w_gear', 'BarlowCondensed-Bold.ttf', 84, 'PRNDSM' + D + '-'),
    ('w_speed', 'BarlowCondensed-Bold.ttf', 112, D + '-'),
    ('w_unit', 'BarlowCondensed-Bold.ttf', 26, L + '/'),
    ('w_alert', 'BarlowCondensed-Bold.ttf', 22, U + ' '),
]
fo = os.path.join(OUT, 'fonts')
os.makedirs(fo, exist_ok=True)
for spec in FONTS:
    bf.bake(fo, *spec)

if a.pilot:
    W, H = 200, 240
    src = Image.open(a.pilot).convert('RGB')
    # the face and shoulder, the part of the picture worth keeping in a box this size
    cw = round(src.height * W / H)
    left = max(0, min(src.width - cw, 190))
    im = src.crop((left, 0, left + cw, src.height)).resize((W, H), Image.LANCZOS)
    px = bytearray()
    for y in range(H):
        for x in range(W):
            r, g, b = im.getpixel((x, y))
            f = min(1.0, x / (W * 0.30)) * min(1.0, (W - 1 - x) / (W * 0.05) + 0.0)
            px += bytes((int(r * f), int(g * f), int(b * f), 255))
    po = os.path.join(OUT, 'pictures')
    os.makedirs(po, exist_ok=True)
    with open(os.path.join(po, 'pilot.json'), 'w') as f:
        json.dump({'w': W, 'h': H, 'rgba': base64.b64encode(bytes(px)).decode('ascii')}, f, separators=(',', ':'))
    print('pilot %dx%d' % (W, H))
